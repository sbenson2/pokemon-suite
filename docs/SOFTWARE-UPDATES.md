# Software updates

The native app, game engine, campaign planner, and game facts have separate
update paths. Settings → Updates is the native control surface; browser Settings
uses the same local API and library. No public feed is configured in development
builds, and this implementation does not publish releases.

| Component | What changes | When it takes effect |
| --- | --- | --- |
| Native Mac app | Swift interface, Python/Node runtimes, host protocol | Normal signed app update; pending games must save and close first |
| Campaign planner | High-level FireRed decisions | Verified handoff at an idle field; emulator/session/viewer remain alive |
| Game engine | Worker, observation and input implementation | Checkpointed owner restart, compatible state schema and exact core identity |
| Game resources / emulator | Exact-revision observation tables or qualified core | Pinned launch configuration; incompatible checkpoints fail without replacing saves |
| Pokédex, routes, evolution, competitive facts | Versioned JSON projections | New planning snapshots; saved requests retain the facts they used |

A package default does not rewrite an existing game's pinned selection. Apply an
engine or planner package explicitly to an existing game. Data activation affects
new plans immediately. The settings preserve installed versions and task data;
there is currently no automatic garbage collection of historical packages.

## Runtime contracts

- `pokemon-suite/package/v1`: immutable ID/version, kind, host API, worker
  protocol, games/platforms, state schemas, exact dependency digests, entrypoints,
  and an exhaustive size/hash inventory. `packages.py` is the executable validator.
- `pokemon-suite/run-lock/v1`: exact selected package graph. Engine, planner, and
  optional game/core components are recorded independently in saved metadata.
- `pokemon-suite/data-lock/v1`: content hashes of each game projection consumed
  by a plan. Local immutable data-cache blobs preserve bundled facts across app
  updates as well as downloaded data revisions.
- `pokemon-suite/capabilities/v1`: implementation support and current readiness
  are different fields. Desktop playback does not imply checkpoints or a bot;
  Emerald companion/evolution support does not imply a complete Emerald campaign.
- `pokemon-suite/qualification/v1`: pinned run with explicit interventions.
  Updating a running campaign requires opt-in and cannot count as an
  uninterrupted completion pass.

The emulator owns frame timing and input. The campaign planner lives in a Node
worker thread, receives observations once per decision, and returns actions and
serializable state. Responses are fenced by worker generation and sequence and
have a deadline. This is fault containment, not a sandbox for untrusted code;
only trusted, verified packages may execute.

## Handoff and recovery

The service records `created → verified → waiting → checkpointed → activating →
healthy → resumed` in a SQLite journal with revision checks and an append-only
transition history. It recovers pending work when the service opens again.

FireRed waits for a stable field, no open menu/battle, completed captures, and no
native or local trade in progress. Frame-critical RNG/capture work is never
replaced mid-operation. Postgame and companion tasks currently defer handoff
until they finish. A stalled task does not become a safe boundary just because a
timeout elapsed.

A whole-engine candidate starts with input held, reads the same save/core
identity, and acknowledges its protocol and package version before gameplay is
released. A failed candidate can restore the old executable while held. This
never rewrites or rolls back the game save, and no automatic software rollback
is attempted after gameplay has been released. Settings exposes **Resume Held
Game** for a failed handoff that still owns its exact checkpoint.

A planner update drains the current action and replaces only its worker. A
planner crash releases no new controller actions; the existing campaign
supervisor preserves the report and paused game. Saved blocked states are not
silently cleared by the update mechanism.

The first installation of this architecture needs a normal app update. A legacy
owner without protocol v1 keeps running and reports that requirement instead of
pretending it can hand off. The app bundles an engine capsule and copies it into
the library's verified immutable store; future app replacements do not delete
pinned engine versions.

## Local release workflow

Install the pinned development dependencies:

```sh
python -m pip install -r pokemon_suite/update-requirements.txt
```

Generate a private local release key outside distributable source. Import its
`.pub` file through Settings → Updates → Release source and trust.

```sh
python scripts/package-components.py keygen --key .private/releases/local.pem
python scripts/package-components.py planner --key .private/releases/local.pem --version 0.1.1 --output dist/suite-planner-0.1.1.pksuite
python scripts/package-components.py engine --key .private/releases/local.pem --version 0.1.1 --output dist/suite-engine-0.1.1.pksuite
python scripts/package-components.py data --key .private/releases/local.pem --version 0.1.1 --output dist/suite-data-0.1.1.pksuite
```

These builders accept only the reviewed source manifest and sanitized public
export. They do not package ROMs, user saves, private adapter resources, Nintendo
artwork, private signing keys, or local competitive preset collections. A
published ID/version cannot be overwritten with different content.

To create a local TUF repository:

```sh
python scripts/publish-package-feed.py --output dist/package-feed --keys .private/releases/tuf dist/suite-engine-0.1.1.pksuite
```

Host its `metadata/` and `targets/` folders together. Configure the feed URL and
independently obtained `metadata/root.json` in Settings. HTTPS is required except
for an explicit loopback development server. TUF verifies signed metadata,
expiry, version rollback protection, and downloaded target hashes. The library
retains trusted metadata between checks. Refresh the one-day timestamp before it
expires; root key rotation needs the normal reviewed TUF rotation procedure.
Use different roots/URLs for stable, preview, and development channels.

## Native distribution

Sparkle 2.9.6 is pinned by SwiftPM. App builds can set the public feed/key without
embedding a private signing key:

```sh
python scripts/build-macos.py --verification /path/to/report.json --engine-package /path/to/published-engine.pksuite --output dist/macos-release --feed-url https://example.org/appcast.xml --public-key PUBLIC_ED25519_KEY --signing-identity 'Developer ID Application: …'
```

The release maintainer must supply a real appcast, sign update archives with
Sparkle's release tools, use a valid Developer ID, and notarize the final app.
The local development build is ad hoc signed and has no public appcast. Sparkle's
relaunch delegate waits for the Suite's ordinary save/close procedure; a pending
trade keeps installation deferred and presents its reason in Settings.

Updater Python libraries have exact version/hash locks and retained licenses.
The current cryptography 50.0.1 release publishes no Intel macOS wheel. The native
Intel target therefore needs a separately built and qualified current dependency;
the builder reports this instead of substituting an obsolete library. This does
not qualify every playback adapter on Windows/Linux merely because the portable
service runs there.

## Validation boundary

The private FireRed canary restored a copied campaign checkpoint, advanced with
the isolated planner, replaced the planner with the same session ID, then changed
the engine owner at its checkpoint and continued with the original team
commitment. It used separate saves and ports; the original run kept progressing.

Synthetic tests cover signatures, corrupt files, path traversal, symbolic links,
immutable versions, exact dependency locks, incompatible host protocols,
revision-pinned data across profiles, expired TUF metadata, tampered targets,
planner deadlines, safe transaction boundaries, and durable journal fencing.
These tests and a short emulator canary do not prove a full unattended campaign
or qualify additional games. FireRed remains the campaign proving ground;
LeafGreen, Emerald, Crystal and later titles retain their actual feature limits.
