Run these blocks in order in an empty directory with `oq` on `PATH`.

<!-- oq:case:valid -->

```sh
cat > note.org <<'ORG'
* Note
:PROPERTIES:
:state: ready
:END:
ORG
cat > strict.toml <<'TOML'
version = 1
[[rules]]
id = "note.state"
select = ".children[]"
assert = '.properties.state == "ready"'
message = "State must be ready"
line = ".property_lines.state // .line"
min_matches = 1
TOML
oq validate --schema strict.toml note.org
```

Exit 0: JSON report with no diagnostics. The rule requires a note in state `ready`.

<!-- oq:case:rejected -->

```sh
oq set -i '.children[0].properties.state = "blocked"' note.org
oq validate --schema strict.toml note.org
```

Exit 1: JSON error `note.state` at line 3. The in-place edit itself is silent.

<!-- oq:case:warning -->

```sh
cp strict.toml warning.toml
printf '\nseverity = "warning"\n' >> warning.toml
oq validate --schema warning.toml note.org
```

Exit 0: the same violation is a warning diagnostic, not an error.

<!-- oq:case:malformed -->

```sh
printf 'version = [\n' > broken.toml
oq validate --schema broken.toml note.org
```

Exit 2: malformed schema; error text on stderr.

<!-- oq:case:usage -->

```sh
oq validate note.org
```

Exit 2: `--schema` is required even if a schema file exists nearby.
