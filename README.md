# Glance

Self-hosted [Glance](https://github.com/glanceapp/glance) dashboard and scrapper service. Uses [mise](https://mise.jdx.dev) for dependencies, [fnox](https://github.com/jdx/fnox) for secret handling and [podman](https://github.com/containers/podman) + [pitchfork](https://github.com/jdx/pitchfork) for container / daemon management.

## Docs

[DeepWiki](https://deepwiki.com/aguimbao/glance)

## Prerequisites

- [mise](https://mise.jdx.dev) / [devcontainers](https://containers.dev/)
- [podman](https://github.com/containers/podman) (+ podman socket active)

## Usage

### Setup

Use your own `.fnox*local.toml` if needed

> If using Proton Pass pass-cli, you need an authenticated pass-cli session with access to the project vault items. Run `mise run setup-pass-cli` to authenticate.

```bash
# devcontainer
devcontainer up

# no devcontainer
mise trust
mise install

# both
mise run setup-pass-cli  # optional, for Proton Pass authentication
```

### Commands

```bash
# All accept --help

# lint
mise run lint
# fmt
mise run fmt
# test
mise run test
# test ci locally
mise run ci
# bump versions
mise run renovate

# up
mise run up
# down
mise run down
```
