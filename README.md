# setup-daml

Install [DPM](https://github.com/digital-asset/dpm) and Daml SDK in GitHub Actions.

```yaml
steps:
  - uses: zenith-network/setup-daml@v1
    with:
      dpm-version: "1.0.22"
      sdk-version: "3.5.9"
  - run: dpm build
```

## Inputs

```yaml
- name: Set up Daml SDK
  uses: zenith-network/setup-daml@v1
  with:
    # Specify certain release of the DPM from GitHub or "latest".
    # If not specified, defaults to "latest".
    dpm-version: "1.0.22"

    # Specify a version of Daml SDK to install.
    # If not specified, no Daml SDK will be installed, only DPM.
    # This argument is passed directly to 'dpm install', so all the formats
    # supported by DPM can be used here.
    sdk-version: "3.5.9"

    # Overwrite which OCI registry to use for fetching Daml SDK.
    # If not specified, DPM will use his default registry.
    dpm-registry: "europe-docker.pkg.dev/da-images/public"

    # Optional token for GitHub REST API queries.
    # May be set to avoid rate limits of GitHub REST API.
    github-token: ${{ github.token }}
```

## Outputs

| Output | Description |
| --- | --- |
| `dpm-version` | Installed DPM version |
| `sdk-version` | Installed SDK version (empty when SDK installation is skipped) |

The action sets `DPM_HOME` to `$RUNNER_TEMP/dpm` and adds `$DPM_HOME/bin` to PATH
for subsequent steps.

> NOTE: Daml SDK installation may bring it's own version of DPM in the bundle.
> For stability reasons we ignore it in the final setup and expose only the version,
> which was resolved from the input - it's going to be the one available in PATH.
