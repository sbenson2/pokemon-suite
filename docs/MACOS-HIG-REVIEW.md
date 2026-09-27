# macOS Human Interface Guidelines review

Reviewed 10 September 2026 for the native SwiftUI/AppKit application. Apple’s official documentation is the design authority. No third-party HIG skill was installed or treated as verified.

## Design foundation

The game screen and artwork extracted from the user's ROM supply the Pokémon identity. Surrounding navigation, forms, windows, and actions use the Mac's own appearance. System fonts, primary/secondary text colors, separator colors, window backgrounds, and the system accent replace the forced red tint. New macOS materials come from native components; the app does not draw an imitation of Liquid Glass. This follows [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos), [Color](https://developer.apple.com/design/human-interface-guidelines/color), and [Typography](https://developer.apple.com/design/human-interface-guidelines/typography).

The interface uses a stable navigation sidebar and bounded content panes. Long forms and lists scroll internally, with visible bounds. Labels are task-oriented, system text styles establish hierarchy, and advanced details expand only when needed.

## Changes by area

| Area | Finding and implemented change | Apple guidance |
| --- | --- | --- |
| Global appearance | Removed the custom red accent. Controls follow the system accent and semantic light/dark colors. System appearance is the default; the existing user preference for a light/dark override remains available. | [Color](https://developer.apple.com/design/human-interface-guidelines/color) |
| App settings | Moved global settings out of the navigation sidebar into a native Settings scene, opened by Command-comma. General, Library, and Support use the Mac settings toolbar, pane titles, and content-dependent window sizes. | [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) |
| Navigation | Kept six peer destinations. Added View-menu navigation with Command-1 through Command-6 and the standard show/hide-sidebar command. Game selection appears on game-specific pages. | [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), [The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar) |
| Games | Removed the repeated page title. Open Library and Add FireRed are toolbar actions with File-menu equivalents. Missing-game requirements open in a focused details sheet. Search has an empty-results state. | [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) |
| Live game | Enlarged the game image inside a plain black canvas. Start/Stop remains in the trainer panel; Manual Play and Bot Settings remain alongside it. Keyboard focus has a visible system-colored outline. Controller buttons are native NSButtons, including shoulder buttons. | [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Team and Pokédex | Health and stats use gauges with numeric values and accessible names. Badge labels distinguish earned and unearned states. Experience shows the engine's remaining-XP value, including Emerald's data shape. Sprites expose species names; decorative duplicates are hidden from accessibility. | [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| Hunting | Replaced the hundreds-item species menu with a searchable native selection sheet. Preview, Queue, and Start remain visible in a fixed action area. Preparation and detailed requirements use disclosure controls. Invalid nickname, level, and limit values show inline feedback and block submission. | [Pickers](https://developer.apple.com/design/human-interface-guidelines/pickers), [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields), [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls) |
| Bot configuration | Separated Task, Shiny collection, New run, Hunting defaults, and Activity. Replaced the JSON preferences editor with labeled fields, pop-up buttons, checkboxes/toggles, and steppers. New runs retain explicit team preview before starting. Technical reports are labeled disclosures or exports. | [Settings](https://developer.apple.com/design/human-interface-guidelines/settings), [Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls) |
| Shiny collection | Added an actionable empty state and readable ownership/save-verification fields. Complete machine-readable records remain in an explicitly technical disclosure. | [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| File operations | Open, import, and export use asynchronous native file panels attached as sheets to the current window. A second file operation cannot open another overlapping panel. | [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) |
| Window sizing | Prevented split content from expanding beyond the window when a form's intrinsic width changes. Main content has a minimum of 1100 × 680 points; the system title bar adds to the outer size. Content panes remain bounded during resizing. | [Windows](https://developer.apple.com/design/human-interface-guidelines/windows), [Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) |
| Keyboard access | Tab, Shift-Tab, and Escape leave the game surface and release held keys. Space is the game's Select key. Focus Game explicitly enters game input. Window deactivation and view removal release input. Standard menu shortcuts remain available. | [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |

## Verification

The native application was exercised with a separate app identifier and disposable library. Existing user save checkpoints were kept outside that library. Checks included:

- Actual screenshots of Games, Live game, Pokédex, Farming, shiny collection, Bot settings, and Settings; light and dark appearance; compact and default window sizes.
- Native accessibility-tree inspection, including `AXAttributedDescription` labels used by current SwiftUI controls, controller names, enabled states, and game focus transitions.
- Command-comma opening a separate Settings window, appearance switching, and Command-number navigation.
- Searching for Snorlax, selecting it, and previewing its route without starting a hunt.
- Typing an invalid nickname and confirming Start Hunt becomes disabled.
- Editing the maximum hunt duration to 120 minutes and verifying the saved preference in the disposable library.
- Previewing a random team without starting a new campaign.
- Opening and cancelling a native library sheet.
- Starting the disposable FireRed session, viewing its title screen, using native controller activation, entering game focus, leaving with Tab/Escape, and stopping through the trainer panel.
- Native streaming/keyboard regression tests, followed by the packaged service tests and signature verification recorded with the build.

## Compact-layout refinement — 11 September 2026

A second pass reduces scrolling and repeated text while retaining the same game, save, and automation commands. It follows Apple's guidance on [disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls), [scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views), [popovers](https://developer.apple.com/design/human-interface-guidelines/popovers), and [writing](https://developer.apple.com/design/human-interface-guidelines/writing).

- Trading combines save selection and connection actions in one row. Shorter sprite cells show more owned Pokémon at once. Overview, Stats, and Moves share one inspector; trade actions stay at its bottom. Save and wireless explanations open on demand.
- Pokédex separates Overview, Locations, and Moves. The species header and Set Up Hunt action stay visible. Stats and basic species facts fit together without scrolling at the minimum window size.
- Farming separates Catch, Traits, Training, and Limits. Preview, Queue, and Start Hunt remain fixed below the active form. Move selection uses a searchable sheet with a four-move limit. Plan and Queue occupy separate panes; detailed requirements and route steps use disclosures.
- Live game keeps trainer controls above Team and Activity. Party rows show position, species, level, health, and held-item artwork; item names and remaining XP open in each Pokémon's details popover.
- Bot settings removes repeated instructions and section titles. Team preview opens as a cancellable sheet. Hunting defaults uses Capture, Traits, and Limits panes.
- Settings uses concise labels and shorter windows. Updates separates App, Bot and Data, History, and Source, with file imports presented as native sheets. Game details separates Overview, Capabilities, and Artwork. Existing provenance and license details remain available.

Native checks for this pass used the installed Mac app at 1280 × 840 outer-window size and its minimum 1100 × 680 content size (1100 × 732 including the title bar). Screenshots cover all six main destinations, Trading's three inspector panes, all four hunt forms, defaults, game details, and Settings in light and dark appearance. The hunt forms, Pokédex overview, and Trading inspector fit without scrolling at the minimum size. Large Pokémon collections, move lists, expanded explanations, and historical records still scroll within bounded panes.

Interaction checks confirmed the four-move selection limit, disabled hunt actions for an invalid nickname, recovery after clearing that value, read-only hunt preview, and team preview/cancellation. The saved collection remains selected with the Shiny filter and displays 104 shiny individuals out of 159 owned. No hunt, trade, or new campaign was started for this review. The app update saves and closes the paused game; it does not resume the bot. The active-play Live layout was source-reviewed; this pass's installed Live screenshot covers the stopped-game state.

## Scope and remaining qualification

### Activity refinement — 13 September 2026

Live → Activity and Bot settings → Activity → Overview now share one native
presentation. **Now** identifies the immediate action, **Why** describes its
published reason or preparation requirement, and **Next** distinguishes a
detour's resumption from the next story checkpoint. Recovery names fainted
members; training shows the assigned individual and level gate; battle moves
use the selected game's local move catalog. Transitional samples are not
presented as decisions, and an older move cannot become the current action.

The first view stays compact. One disclosure reveals Progress, Decisions and
Diagnostics. Progress contains the relevant story, training, EV, hunt, storage
and game counters. Recent actions group repetitions; each opens a bounded
sheet with controller inputs and recorded policy evidence. Unknown counters
remain absent, rather than becoming zero. A stale update indicates missing
telemetry instead of asserting that emulation stopped. The emulator checkpoint
is explicitly separate from an in-game save, and measured XP rates remain
separate from estimates.

This follows Apple's [feedback](https://developer.apple.com/design/human-interface-guidelines/feedback),
[writing](https://developer.apple.com/design/human-interface-guidelines/writing)
and [disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
guidance: useful status in context, clear action labels and less detail until
requested. System typography, semantic appearance, selectable text, native
controls and the existing bordered scroll pane are retained. Status includes
text and a symbol, so color is not the only signal.

Read-only FireRed telemetry now describes the committed training individual by
its actual identity and publishes observed battle participants. It never guesses
that the lead Pokémon is the trainee, mutates the planner or calculates a new
battle policy. Older engines still display the published level requirement
when the individual is unavailable. Tests cover these projections and task,
pause, stale-data and failure states. Offscreen native SwiftUI renderings check
the compact Live-pane summary in both appearances; these are not a complete
spoken VoiceOver or cross-device qualification.

### Activity outline — 22 September 2026

At the owner's request, Activity now explains the goal hierarchy instead of
only the latest sample, which supersedes the compact first-view limit above.
A **Postgame goal** (or **Story goal**) card names the active agenda entry with
its published measurement, such as registered species and the Kanto and
diploma counts. A **Current task** card names a National Pokédex evolution by
species, with ROM artwork, the published requirement and the measured level
or friendship. Its **Plan** lists the evolution controller's steps; a step is
done only when the running objective or the party proves it, so the view never
claims a withdrawal, evolution or save that it cannot see.

**Right now** keeps the Now and Why semantics. Battles report that a battle is
in progress without naming the battler, since party order does not identify
it. The evolution scene is reported from the game mode. A trip shows the
published destination, next exit, steps on the current map, travel mode and
the maps already crossed; the planner publishes only the next hop, so no full
route, ETA or reason for walking instead of flying is inferred. While a sample
is only a wait, the newest published action appears with its age, up to two
minutes. Internal wait codes are explained or omitted.

**Up next** lists runnable agenda entries after the active one. **Not running
now** lists entries the agenda cannot run, each with its published reason and
retry time. An expired retry no longer appears as deferred. The full postgame
checklist sits behind a disclosure, and Progress, Decisions and Diagnostics
keep their disclosure. The narrow Live pane uses one scrolling column; Bot
settings shows the goal and task beside the current activity. The meter is
drawn in SwiftUI so offscreen renderings match the window. System typography,
semantic colors, text-plus-symbol status and selectable text are unchanged.
Tests cover the outline, plan evidence, agenda states, routes and wait text;
offscreen renderings check the postgame outline at Live-pane widths in both
appearances.

This is a source-based HIG review with native UI verification, not Apple certification or a claim of exhaustive accessibility compliance. A complete spoken VoiceOver walkthrough, Switch Control testing, a dedicated 200% in-app text-size option, and device/OS testing across the full macOS support range remain release qualification work. Native semantic colors and materials follow accessibility preferences; a full contrast measurement under every system setting has not been performed. The emulated game's own screen is not converted into a fully accessible game interface by this work.

The review applies to the native Mac panels. The browser fallback for advanced competitive and platform-specific tools remains a separate interface. Public Developer ID signing, notarization, and Intel qualification are separate release work described in [Mac app setup](MACOS.md).
