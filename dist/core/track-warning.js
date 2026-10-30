export function trackWarning(ref, state, cli) {
    const suggestion = state.track_suggestion;
    if (!suggestion || ref.archived)
        return undefined;
    const command = `${cli} track set ${suggestion.track} --change ${ref.id}`;
    return `Track ${suggestion.track} suggested; confirm with \`${command}\`.`;
}
