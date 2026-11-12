# bambu-cli

A CLI for agents to **monitor** a Bambu Lab printer and **prepare** prints
(slice, inspect, stage). Built for a printer kept in **cloud mode** (so Bambu
Handy keeps working): agents watch and prepare, a human taps Start in Handy.

Ships as a single standalone binary, `bambu`, installed on PATH via mise.

## Install

On the agent box it is managed by mise (see `agentic-setup`):

```toml
# services/agent/mise/config.toml
"github:Niklas-Flaig/bambu-cli" = "latest"
```

`mise install` pulls the binary from the latest GitHub release (a
`bambu-linux-x86_64.tar.gz` asset) and puts `bambu` on PATH; the nightly
`mise upgrade` keeps it current. For a private repo, mise needs a GitHub token
(`GITHUB_TOKEN` / `MISE_GITHUB_TOKEN`) in its environment.

For development:

```sh
bun install
bun run bambu <command>     # run from source
bun run compile             # build the ./bambu binary
```

## Commands

### Monitor (needs only the access code)

| Command | Purpose |
| --- | --- |
| `bambu status [--json]` | state, progress, temperatures, errors |
| `bambu watch [--json] [--interval=5] [--timeout=<min>] [--until=FINISH]` | follow a print to FINISH/FAILED |
| `bambu ams [--json]` | AMS trays |
| `bambu info [--json]` | model, firmware, serial |

### Prepare

| Command | Purpose |
| --- | --- |
| `bambu slice <stl> [-o out.gcode.3mf] [--process=…] [--filament=…] [--nozzle=0.4]` | STL → printable `.gcode.3mf` (via the slicer sidecar) |
| `bambu inspect <file.gcode.3mf> [--json]` | plates, print time, filament, thumbnail |
| `bambu stage <file.gcode.3mf> [--to-board]` | upload to the Bambu cloud (→ Handy); board fallback |
| `bambu cloud-login` | one-time Bambu account login |
| `bambu snapshot [out.jpg]` | camera still (needs LAN liveview; optional) |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok / FINISH |
| 2 | print FAILED (`watch`) |
| 3 | timeout (`watch`) |
| 4 | configuration (missing code/token/config) |
| 5 | connection to the printer |
| 64 | bad usage |

## Configuration

Non-secret settings: built-in defaults < `~/.config/bambu/config.json` < env
vars (`BAMBU_HOST`, `BAMBU_SERIAL`, `BAMBU_MODEL`, `BAMBU_SLICER_URL`,
`BAMBU_REGION`). See `bambu.config.example.json`. The binary carries no device
details — host and serial must come from config or env.

Secrets (never in a repo): `BAMBU_ACCESS_CODE` or `~/.config/bambu/access-code`
(chmod 600); `BAMBU_CLOUD_TOKEN` or `~/.config/bambu/cloud.json`. On the agent
box these come from `agentic-setup` (`env/bambu.env`).

## Development

```sh
bun test            # unit tests (report/HMS/model/inspect)
bun run typecheck
bun run format
```

Protocol references in the source: OpenBambuAPI (Doridian) and pybambu
(ha-bambulab). Monitoring is verified live against an X1 Carbon.

A tagged release (`git tag v0.2.0 && git push --tags`) triggers
`.github/workflows/release.yml`, which builds `bambu-linux-x86_64.tar.gz` and
attaches it to the release for the mise github backend to pull.
