;; Runnable protocol demo; input is the host's canonical, schema-checked JSON.
;; Only declared integer fields are parsed. This is not a general JSON parser.
(module
  (import "sdlc" "memory" (memory 16 1024))
  (export "memory" (memory 0))
  (global $end (mut i32) (i32.const 0))
  (global $out (mut i32) (i32.const 8192))
  (data (i32.const 64) "\22state\22:{")
  (data (i32.const 74) "\22used\22:")
  (data (i32.const 82) "\22config\22:{")
  (data (i32.const 93) "\22limit\22:")
  (data (i32.const 102) "\22operation\22:\22record\22")
  (data (i32.const 123) "\22operation\22:\22reset\22")
  (data (i32.const 143) "\22input\22:{")
  (data (i32.const 153) "\22units\22:")
  (data (i32.const 162) "{\22output\22:")
  (data (i32.const 173) "\22operation\22:\22guard\22")
  (data (i32.const 193) "{\22decision\22:\22deny\22,\22code\22:\22demo_limit\22,\22message\22:\22Demo limit exhausted\22}")
  (data (i32.const 266) "{\22decision\22:\22pass\22}")
  (data (i32.const 286) "{\22used\22:")
  (data (i32.const 295) ",\22remaining\22:")
  (data (i32.const 309) "}")
  (data (i32.const 311) ",\22facts\22:")
  (data (i32.const 321) "{\22used\22:")
  (data (i32.const 330) ",\22remaining\22:")
  (data (i32.const 344) "}")
  (data (i32.const 346) ",\22state\22:{\22used\22:")
  (data (i32.const 364) "},\22events\22:[{\22name\22:\22")
  (data (i32.const 386) "charged\22,\22data\22:{\22units\22:")
  (data (i32.const 412) "reset\22,\22data\22:{\22used\22:0")
  (data (i32.const 436) "}}]")
  (data (i32.const 440) "}")

  ;; Return the first byte after a token, or zero. Every scan is request-bounded.
  (func $find (param $p i32) (param $key i32) (param $size i32) (result i32)
    (local $i i32)
    (block $missing
      (loop $next
        (br_if $missing (i32.gt_u (i32.add (local.get $p) (local.get $size)) (global.get $end)))
        (local.set $i (i32.const 0))
        (block $different
          (loop $compare
            (if (i32.eq (local.get $i) (local.get $size))
              (then (return (i32.add (local.get $p) (local.get $size)))))
            (br_if $different (i32.ne
              (i32.load8_u (i32.add (local.get $p) (local.get $i)))
              (i32.load8_u (i32.add (local.get $key) (local.get $i)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $compare)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $next)))
    (i32.const 0))

  ;; Match only a root object key, skipping strings and nested subject/extension data.
  (func $root (param $p i32) (param $key i32) (param $size i32) (result i32)
    (local $depth i32) (local $quoted i32) (local $byte i32) (local $found i32)
    (block $missing (loop $next
      (br_if $missing (i32.ge_u (local.get $p) (global.get $end)))
      (local.set $byte (i32.load8_u (local.get $p)))
      (if (local.get $quoted) (then
        (if (i32.eq (local.get $byte) (i32.const 92)) (then
          (local.set $p (i32.add (local.get $p) (i32.const 2)))
          (br $next)))
        (if (i32.eq (local.get $byte) (i32.const 34))
          (then (local.set $quoted (i32.const 0))))
      ) (else
        (if (i32.eq (local.get $byte) (i32.const 34)) (then
          (if (i32.eq (local.get $depth) (i32.const 1)) (then
            (local.set $found (call $find (local.get $p) (local.get $key) (local.get $size)))
            (if (i32.eq (local.get $found) (i32.add (local.get $p) (local.get $size)))
              (then (return (local.get $found))))))
          (local.set $quoted (i32.const 1))))
        (if (i32.or (i32.eq (local.get $byte) (i32.const 123))
                    (i32.eq (local.get $byte) (i32.const 91)))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.or (i32.eq (local.get $byte) (i32.const 125))
                    (i32.eq (local.get $byte) (i32.const 93)))
          (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
      ))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $next)))
    (i32.const 0))

  (func $number (param $p i32) (result i32)
    (local $value i32) (local $digit i32)
    (if (i32.eqz (local.get $p)) (then unreachable))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $digit (i32.sub (i32.load8_u (local.get $p)) (i32.const 48)))
        (br_if $done (i32.gt_u (local.get $digit) (i32.const 9)))
        (local.set $value (i32.add (i32.mul (local.get $value) (i32.const 10)) (local.get $digit)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $next)))
    (local.get $value))

  (func $byte (param $byte i32)
    (i32.store8 (global.get $out) (local.get $byte))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  (func $emit (param $p i32) (param $size i32)
    (local $i i32)
    (block $done (loop $next
      (br_if $done (i32.eq (local.get $i) (local.get $size)))
      (call $byte (i32.load8_u (i32.add (local.get $p) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $next))))

  (func $integer (param $value i32)
    (if (i32.lt_s (local.get $value) (i32.const 0)) (then
      (call $byte (i32.const 45))
      (local.set $value (i32.sub (i32.const 0) (local.get $value)))))
    (if (i32.ge_u (local.get $value) (i32.const 10))
      (then (call $integer (i32.div_u (local.get $value) (i32.const 10)))))
    (call $byte (i32.add (i32.rem_u (local.get $value) (i32.const 10)) (i32.const 48))))

  ;; This small demo accepts at most 64 KiB, below the host's general JSON limit.
  (func (export "sdlc_alloc") (param $size i32) (result i32)
    (if (i32.gt_u (local.get $size) (i32.const 65536)) (then unreachable))
    (i32.const 65536))

  (func (export "sdlc_call") (param $ptr i32) (param $size i32) (result i64)
    (local $count i32) (local $limit i32) (local $remaining i32)
    (local $record i32) (local $reset i32) (local $quantity i32)
    (global.set $end (i32.add (local.get $ptr) (local.get $size)))
    (local.set $count (call $number (call $find (call $root (local.get $ptr) (i32.const 64) (i32.const 9)) (i32.const 74) (i32.const 7))))
    (local.set $limit (call $number (call $find (call $root (local.get $ptr) (i32.const 82) (i32.const 10)) (i32.const 93) (i32.const 8))))
    (local.set $record (call $root (local.get $ptr) (i32.const 102) (i32.const 20)))
    (local.set $reset (call $root (local.get $ptr) (i32.const 123) (i32.const 19)))
    (if (local.get $record) (then
      (local.set $quantity (call $number (call $find (call $root (local.get $ptr) (i32.const 143) (i32.const 9)) (i32.const 153) (i32.const 8))))
      (local.set $count (i32.add (local.get $count) (local.get $quantity)))))
    (if (local.get $reset) (then (local.set $count (i32.const 0))))
    (local.set $remaining (i32.sub (local.get $limit) (local.get $count)))
    (global.set $out (i32.const 8192))
    (call $emit (i32.const 162) (i32.const 10))
    (if (call $root (local.get $ptr) (i32.const 173) (i32.const 19)) (then
      (if (i32.le_s (local.get $remaining) (i32.const 0)) (then
    (call $emit (i32.const 193) (i32.const 72))
      ) (else
    (call $emit (i32.const 266) (i32.const 19))
      ))
    ) (else
    (call $emit (i32.const 286) (i32.const 8))
    (call $integer (local.get $count))
    (call $emit (i32.const 295) (i32.const 13))
    (call $integer (local.get $remaining))
    (call $emit (i32.const 309) (i32.const 1))
    ))
    (call $emit (i32.const 311) (i32.const 9))
    (call $emit (i32.const 321) (i32.const 8))
    (call $integer (local.get $count))
    (call $emit (i32.const 330) (i32.const 13))
    (call $integer (local.get $remaining))
    (call $emit (i32.const 344) (i32.const 1))
    (if (i32.or (local.get $record) (local.get $reset)) (then
    (call $emit (i32.const 346) (i32.const 17))
    (call $integer (local.get $count))
    (call $emit (i32.const 364) (i32.const 21))
    (if (local.get $record) (then
    (call $emit (i32.const 386) (i32.const 25))
    (call $integer (local.get $quantity))
    ) (else
    (call $emit (i32.const 412) (i32.const 23))
    ))
    (call $emit (i32.const 436) (i32.const 3))
    ))
    (call $emit (i32.const 440) (i32.const 1))
    (i64.or (i64.shl (i64.const 8192) (i64.const 32))
      (i64.extend_i32_u (i32.sub (global.get $out) (i32.const 8192))))
  )
)
