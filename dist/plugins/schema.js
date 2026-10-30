import { Ajv2020 } from 'ajv/dist/2020.js';
import * as path from 'node:path';
import { INPUT_CONTROL_FIELDS, fail, object } from './api.js';
import { safeRelative } from './package.js';
function inspect(value, depth = 0) {
    if (depth > 32)
        fail('plugin_schema', 'Schema is too deep');
    if (Array.isArray(value)) {
        for (const item of value)
            inspect(item, depth + 1);
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    for (const [key, item] of Object.entries(value)) {
        if (['$async', '$data', '$dynamicRef', '$dynamicAnchor', '__proto__', 'constructor', 'prototype'].includes(key)) {
            fail('plugin_schema', 'Executable/dynamic schema features are refused');
        }
        if (['$ref', '$id'].includes(key) && typeof item === 'string'
            && /^[a-z]+:|^\/|\\|\.\./i.test(item)) {
            fail('plugin_schema', 'Schema references must be package-local');
        }
        inspect(item, depth + 1);
    }
}
export class PluginSchemas {
    files;
    ajv = new Ajv2020({ strict: true, coerceTypes: false, useDefaults: false,
        removeAdditional: false, allErrors: false, validateFormats: false });
    compiled = new Map();
    inputSerial = 0;
    loaded = new Set();
    constructor(files) {
        this.files = files;
    }
    loadReference(reference, base) {
        const relative = reference.split('#')[0];
        if (!relative)
            return;
        if (!safeRelative(relative))
            fail('plugin_schema', 'Invalid local schema path');
        const name = path.posix.join(path.posix.dirname(base), relative);
        if (this.loaded.has(name))
            return;
        const bytes = this.files.get(name);
        if (!bytes)
            fail('plugin_schema', 'Missing local schema document');
        let value;
        try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        }
        catch {
            fail('plugin_schema', 'Invalid local JSON schema');
        }
        inspect(value);
        if (typeof value !== 'boolean')
            object(value, 'schema document');
        this.loaded.add(name);
        this.ajv.addSchema(value, name);
        this.references(value, name);
    }
    references(value, base = '') {
        if (Array.isArray(value)) {
            for (const item of value)
                this.references(item, base);
            return;
        }
        if (!value || typeof value !== 'object')
            return;
        for (const [key, item] of Object.entries(value)) {
            if (key === '$ref' && typeof item === 'string')
                this.loadReference(item, base);
            else
                this.references(item, base);
        }
    }
    compile(value, name) {
        const previous = this.compiled.get(value);
        if (previous)
            return previous;
        inspect(value);
        const input = typeof value === 'string' ? { $ref: value } : value;
        if (typeof value === 'string' && !value.startsWith('#') && !safeRelative(value.split('#')[0])) {
            fail('plugin_schema', 'Invalid local schema path');
        }
        try {
            if (typeof value === 'string')
                this.loadReference(value, '');
            else
                this.references(value);
            let validate;
            if (name) {
                this.ajv.addSchema(input, name);
                validate = this.ajv.getSchema(name);
            }
            else
                validate = this.ajv.compile(input);
            this.compiled.set(value, validate);
            return validate;
        }
        catch {
            return fail('plugin_schema', 'Schema is invalid or has an unresolved local reference');
        }
    }
    check(schema, value, field) {
        if (!this.compile(schema)(value))
            fail('plugin_schema', `${field} does not match its plugin schema`);
    }
    /** Follow only applicators that validate the same input root, never nested plugin data. */
    input(schema) {
        let name;
        do {
            name = `sdlc-input-${this.inputSerial++}.json`;
        } while (this.files.has(name) || this.ajv.getSchema(name));
        // Give anonymous input schemas a retrieval URI so Ajv resolves local pointers and anchors too.
        const validate = this.compile(schema, name);
        const seen = new Set();
        const resolver = this.ajv.opts.uriResolver;
        const visit = (value, base, resolved = false) => {
            if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value))
                return;
            seen.add(value);
            const v = value;
            if (!resolved && typeof v.$id === 'string')
                base = resolver.resolve(base, v.$id);
            const named = (item) => item && typeof item === 'object' && !Array.isArray(item)
                ? Object.keys(item) : [];
            const required = Array.isArray(v.required) ? v.required : [];
            const dependencies = v.dependentRequired && typeof v.dependentRequired === 'object'
                ? Object.values(v.dependentRequired).flatMap((item) => Array.isArray(item) ? item : []) : [];
            if (INPUT_CONTROL_FIELDS.some((key) => [...named(v.properties), ...named(v.dependentRequired),
                ...named(v.dependentSchemas), ...required, ...dependencies].includes(key))) {
                fail('plugin_schema', 'Operation input schema declares reserved transport identity');
            }
            if (typeof v.$ref === 'string') {
                const reference = resolver.resolve(base, v.$ref);
                const target = this.ajv.getSchema(reference);
                if (!target)
                    fail('plugin_schema', 'Input schema has an unresolved local reference');
                // Ajv supplies the effective $id scope, including scopes along a referenced JSON pointer.
                visit(target.schema, target.schemaEnv.baseId, true);
            }
            for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
                if (Array.isArray(v[keyword]))
                    for (const item of v[keyword])
                        visit(item, base);
            }
            for (const keyword of ['not', 'if', 'then', 'else'])
                visit(v[keyword], base);
            if (v.dependentSchemas && typeof v.dependentSchemas === 'object') {
                for (const item of Object.values(v.dependentSchemas))
                    visit(item, base);
            }
        };
        visit(validate.schema, validate.schemaEnv.baseId, true);
    }
    manifest(manifest) {
        for (const schema of Object.values(manifest.schemas))
            this.compile(schema);
        for (const op of Object.values(manifest.operations)) {
            this.input(op.input);
            this.compile(op.output);
        }
        for (const schema of Object.values(manifest.events))
            this.compile(schema);
        this.check(manifest.schemas.state, manifest.initialState, 'initialState');
    }
}
