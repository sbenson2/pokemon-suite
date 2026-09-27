# FireRed companion theme

The iPhone Live Game dashboard follows the supplied reference's composition:
centered ROM wordmark navigation menu and circular controls, actual game viewport, Trainer beside
Location, then the six-member Team beside Session. Rounded metal rims, shallow
header strips, dark inset surfaces and blue interaction accents follow
the same reference. Light appearance uses the same geometry with pale surfaces.
System, Light and Dark remain in Settings; iPad retains its native sidebar.
The private design references are not application resources or public fixtures.

The finishing pass inspected the actual FireRed Rev 1 standard window and battle
textbox tiles and palettes directly from the qualified local ROM, and reviewed
the party and health-box graphics in its matching local symbol/build source.
The standard window uses a slate rim; the battle textbox supplies blue
`#29526B`, warm gold `#CEAD4A` and off-white `#E7DEE7`. Source PNG preview palettes
are not assumed to be the palettes used by the running game.

At the user's request, PixelLab generated a private UI style study from the
decoded battle textbox tile reference (asset
`045d1f5d-8870-4ddb-b328-1b850a5d913f`). Its thin inset borders, slate-blue title
tabs, stepped corners and outlined meters inform the SwiftUI components across
the companion. The concept layout and silver outer frames remain. The generated
study is not a rasterized app interface, an extracted ROM asset or a shipped
resource. Menu-reference decoding did not alter the host API, ROM, save or bot.

## Components and data

`native/ios/Companion/GameTheme.swift` owns original SwiftUI panel framing,
colors and meters. These are app-created components, not extracted game windows.
`LiveView.swift` owns the viewport and adaptive dashboard. `ReferenceDashboard`
provides the compact two-row arrangement; `ReferenceChrome` provides one shared
header and logo menu, owned by `CompanionRoot`. Settings and Activity flank the
centered wordmark with separate 44pt touch targets. Tapping the wordmark opens an anchored native popover with Games,
Live game, Trading, Pokédex, Hunting and Bot Settings, followed by game selection,
sound, Save Game, Start/Stop Game and Settings. Its navigation uses ordinary buttons so live
telemetry refreshes do not interfere with context-menu selection. There is no
bottom navigation dock. Games, Trading, Pokédex, Hunting and Bot Settings use
the identical header and a bounded page panel with the Live Game silver rim and
slate title strip. Search lives inside each page as a native search field, so
hiding the former navigation bar does not remove search. Grouped forms retain
their native controls with the companion panel fill; scroll regions use the same
stepped inner frame. Detail sheets retain native navigation and dismissal.
`LiveLocationPanel` uses the owning cartridge's Town Map tiles, tilemaps and
palette, plus its 16×16 Red/Leaf head selected from the observed trainer gender.
The image keeps the original aspect ratio and nearest-neighbor pixels. Tapping
opens the larger map. The observer publishes `spectator.map.townMap` using the
game's section dimensions, integer division, saved escape/dynamic warps and
landmark overrides, including separate Route 21 halves. The head center is
`(8*x+36, 8*y+36)` in the 240×160 map. No guessed route center or substitute
diagram is used. Unknown/stale locations are explicitly unavailable/last known.
Activity remains in the header.
Session keeps six counters with separate prominent 44pt Telemetry and Manual
Play buttons. Telemetry opens all published counters and diagnostics; Manual Play
uses the existing input handoff. Start/Stop Game remains in the logo menu.
Running/Paused/Stopped/Waiting describes the emulation session. Missing counters
stay unknown; badge counts and the former Mode row remain absent.
The logo menu keeps
Hunting and Bot Settings reachable. Library and trading tiles share the framing;
Pokédex rows share the palette; settings retain native forms.

The viewport remains actual streamed emulator output with its aspect ratio and
nearest-neighbor sampling. Its observation of video frames is separate from the
dashboard, which uses the existing telemetry updates. Navigation does not stop
the host game. Manual input, save, bot settings and stop/start use existing
commands. Opening trainer, party or activity details sends no gameplay commands.

`SuiteCore/PartyMemberPresentation.swift` validates display values. Unknown HP,
experience, level and gender remain unknown. Party order is preserved. A battle
HP override requires matching published slot and National species identity, a
current battle and fresh telemetry. Being first in the party is not evidence of
being the active battler. Older hosts without battle identity retain their
published party health. The compact layout's blue first-slot marker means
**party lead**, not active battler. Details distinguish party position and show
held item, experience and status; compact slots show HP and available XP progress.

Tapping a team member replaces the grid inside the same Team panel with
`PartyInlineDetails`. Tapping its Pokémon header returns to the roster. The
grid reserves its current height during inspection, keeping the viewport and
neighboring panels in place. The facts area has a visible border and scrolls
when needed. Opening and closing use a short fade with a subtle scale change;
Reduce Motion removes the scale. Expanded text layouts scroll the dashboard to
the Team header on selection without moving the game viewport.

Details keep reading live telemetry. `PartyInspection` follows a member through
roster reordering when its published species, nickname, shiny state and gender
identify a unique match. Current telemetry has no individual Pokémon ID:
ambiguous duplicate matches, a missing member or a changed game/save close the
inspector instead of silently selecting a different Pokémon. Layout-width and
text-size changes also return to the roster. HP, XP, level and item updates do
not dismiss details. Unknown held items remain unknown; an explicitly empty
held-item slot displays None.

The expanded FireRed inspector also reads the existing authenticated inventory
endpoint with `source=current`. It adds actual learned moves, current/max PP from
that save, move type/power/accuracy, ability, sex, nature, typing, friendship and
individual stats with IVs/EVs. It does not show the species learnset as the owned
Pokémon's moves. The fixed header keeps the live level and sex visible; the
bordered facts area scrolls. Main compact detail text is 14pt, with larger native
Dynamic Type in expanded layouts. Accessibility text replaces the stats table
with stacked readings instead of shrinking its columns.

`PartyDetailSnapshot` accepts only a valid current FireRed save with the matching
session and current campaign or hunt owner. A current hunt takes precedence over
retained campaign history. It matches a unique party member by National species
and shiny state, ignores saved slot reordering, rejects boxed/ambiguous matches,
and retains the decoded individual ID after the initial match. The extra facts
carry their actual last-save time and stats carry their saved level. Live level,
HP and XP continue to use spectator telemetry. The existing worker checkpoints
roughly every 30 seconds; the inspector checks the cached inventory every 15
seconds while open and active. Requests cancel on dismissal, backgrounding, or
game/session changes. This adds no game commands or forced saves.

Sex uses the Gen 3 personality-byte threshold from the game-specific gender
ratio. PP maxima preserve each move slot's PP Up bits. These follow FireRed's
[Pokémon functions](https://github.com/pret/pokefirered/blob/c75f352304d529f6ba92d4f74b9cf8b5c3810788/src/pokemon.c)
and the local Pokédex supplies game-specific move and species facts. Missing or
invalid values remain unknown.

Activity and Session use the existing shared `ActivityPresentation` for Now,
Why, Next, progress, counters and decision evidence. Emulator availability,
bot activity and manual input ownership remain distinct. The host remains authoritative;
the UI does not infer a successful catch, save or trade from animation.

## Runtime artwork

| Artwork | Source and decoding | Use | Fallback |
| --- | --- | --- | --- |
| Pokémon front/shiny sprites | Configured user ROM through the existing GBA graphics-table, palette and bounded LZ77 reader | Party, Pokémon details, Trading and Pokédex | Native unknown-artwork symbol |
| Trainer portraits | Existing exact-revision-qualified FireRed trainer tables and palettes | Trainer panel and details | Native person symbol |
| Badges | Existing exact-revision-qualified badge tiles and palette, with native Kanto color treatment | Eight-position badge case and trainer details | Native seal with earned/not-earned label |
| Poké Ball item | Existing qualified item tables and palette | Game menu and actual party-count markers | Native circle symbol |
| Pokémon wordmark | Existing `CartridgeArtwork.logo` selection, including qualified compatible-ROM fallback, and `ROMArtworkLoader` | Live header | Native text |
| Cartridge art | Existing host artwork selection and cached native cartridge renderer | Library | Existing neutral cartridge presentation |

No offsets or decoders were added for the theme. Supported profiles and source
provenance remain documented in [ROM resources](ROM-RESOURCES.md). Artwork uses
the existing authenticated host connection and memory caches. ROMs, derived
images, saves and private screenshots are not added to the release manifest.
The native layout-test telemetry is synthetic and contains no proprietary art.

## Deliberate limits

Town Map artwork is qualified for the exact English FireRed 1.1 ROM initially;
other revisions/games stay unavailable until their layouts are verified. Graphics
are decoded from the user's original configured cartridge and held in bounded
host/client caches, never bundled with the software. The location observer only
reads existing save-block buffers; it does not open the game map, press buttons,
modify the ROM, or change navigation/battle policy.

The exact displayed battle, party and statistics depend on the running save.
The reference's invented numbers and field scene are not reproduced. Game-window
tiles, bitmap fonts and replacement badge images are not included. FireRed's
trainer-card badges use a single monochrome palette in the actual ROM. The
companion's `BadgeColors` applies presentation colors to those decoded images,
preserving their silhouettes, facets and transparency: silver Boulder, blue
Cascade, orange/gold Thunder, eight-color Rainbow, pink Soul, gold Marsh,
orange Volcano and green Earth. Unearned badges remain desaturated and subdued.
The color treatment is app-created, not claimed as a color palette extracted
from FireRed. It applies only to individual Kanto badge icons in FireRed and
LeafGreen; other games, item icons and missing-artwork symbols retain their
existing rendering. The host PNGs, ROM, save and bot are unchanged. App chrome
and the small library console symbol are drawn in SwiftUI.

No new emulator, radio implementation or bot policy ships in this companion.
Shared UI code can expose features added by a newer host, but installing the
companion does not update the host engine. Existing host capability limits still
apply. The architecture does not establish copyright permission or distribution
approval for user-supplied artwork; release review remains separate.

## Layout checks

The dashboard stays inside a bordered scroll region above the system home indicator. The former dock height is used for larger Trainer/Location and Team/Session panels, with increased compact text and spacing.
Party details stay inline; trainer and activity details retain native sheets.
Narrow windows and large Dynamic Type use one
column; wide layouts keep the game beside its dashboard. At standard text size
on a 402×874pt iPhone, all six slots, Telemetry and Manual Play fit together without scrolling.
The compact arrangement applies at dashboard widths of at least 365pt through
Large Dynamic Type. Larger text uses the expanded native text layout. Manual
play shows the existing controller in that expanded layout. Pixel images stay
crisp. Status has a text equivalent and badges have earned-state labels.

The design follows Apple's [layout](https://developer.apple.com/design/human-interface-guidelines/layout),
[accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
and [scroll view](https://developer.apple.com/design/human-interface-guidelines/scroll-views)
guidance. This is an implementation review, not Apple certification.

`PartyMemberPresentationTests` checks missing and invalid data, fainted and
poisoned states, party/battler identity, nicknames and experience.
`LiveThemeLayoutTests` renders synthetic light/dark, narrow, wide and large-text
layouts. `LiveThemeUITests` checks the no-scroll six-member composition,
inline team selection, unchanged Team/viewport bounds, continued frame delivery,
activity details and logo-menu destinations against the paired host without game
commands. `PartyInspectionTests` covers repeated taps, live detail updates,
reordering, ambiguous duplicates and changed or missing saves/members. Large-text
interaction checks ensure the last team member opens a reachable detail header.
`PartyDetailSnapshotTests` checks saved/live level separation, move slot and PP
Up handling, zero PP/EV readings, sex thresholds, invalid values, duplicate
matches, and isolation between games, saves and individuals. The live UI check
loads and scrolls actual moves inside the bounded panel while keeping its return
button and the rest of the dashboard reachable.
`FieldPreviewTests` checks the native map shape, consecutive
observations, battle transitions, map changes, stale telemetry and disconnection.
`LocationMapTests` checks authoritative cell bounds, observed gender, game isolation
and stale data. Engine map tests verify route division, cave entrance warps,
landmark overrides and immutable observation integration. ROM decoder tests verify
tile ordering, palette banks, flip flags, opaque backgrounds and transparent heads. Panel-role
checks verify that the map is separate from Session, Manual Play and Telemetry
have visible nonoverlapping 44pt targets, and Telemetry opens full counters.
Existing mobile navigation, rotation,
large-text and frame-delivery regressions
remain in the test suite.

## Trainer character

Trainer portraits follow the observed cartridge character. The FireRed observer
publishes BOY/GIRL strings; the presentation layer also accepts legacy native
0/1 values without coercing strings into numbers. The observed save takes
precedence over a run's planned character. Unknown values remain unknown and
the companion shows a neutral person symbol instead of assuming the male
portrait. Both compact and expanded cards use the same character selection and
include it in the trainer button's accessibility value.

The retained female-save replay proves the original telemetry bug and verifies
the corrected portrait across restoration, with unchanged SRAM and party. The
companion update changes no game inputs or bot policy. Installing the corrected
engine presentation uses the normal verified handoff and records the update in
an active campaign's qualification history.
