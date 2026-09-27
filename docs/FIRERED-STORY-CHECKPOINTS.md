# FireRed story checkpoints

The UI uses the actual committed campaign, not a separate list of estimated
percentages. Open **Bot Settings → Story progress**. Chapters expand to individual
actions, their destinations, prerequisites, completion criteria and major-battle
preparation targets. The current objective, present location and immediate
route are separate fields. Completed steps can be hidden.

The normal planned badge order is Brock, Misty, Lt. Surge, Erika, Koga, Sabrina,
Blaine, Giovanni. The cartridge permits some alternate orders: Sabrina's badge
is **not** the key to Blaine's door. Cinnabar Gym requires the Secret Key from
Pokémon Mansion. Surf access requires Koga's badge. The planner retains Sabrina
when traveling elsewhere; visiting a town does not award its badge.

Before the parcel route, the startup controller completes the title/Continue
flow, trainer setup and committed starter selection. Navigation between story
objectives includes forest, cave, route and city travel; the immediate route is
displayed separately rather than claiming every visited map as a completed task.

## Evidence and recovery

- **Verified in game:** the observed completion condition is true. Badges are
  read independently from all eight native badge flags.
- **Completed earlier in this run:** the planner's retained prefix records the
  step. Consumed items and resettable puzzle state need not remain true forever.
- **In progress / Upcoming:** the current selected objective or a remaining step.
- **If needed:** Bill's first Sevii trip must be completed if it was entered.
- **Awaiting game evidence:** a safe observation is unavailable. The controller
  keeps the last stable presentation through transitions, tagged with its frame.
- **Needs review:** a recorded badge disagrees with the current native flag. The
  presentation shows the conflict and does not invent a badge.

Presentation is read-only and cannot advance the planner. The existing planner
verifies completion before its story handoff, retains task/party commitments
through menus and restarts, and can revisit resettable field puzzles. Training,
healing, supplies and field-carrier prerequisites may temporarily own control;
the underlying planned step remains visible. Battle targets shown are the
current campaign's authored preparation thresholds, not observed team levels.

Active coordinate scripts are route events, not ordinary walking tiles. Routes
prefer to go around an unrelated active scene; explicit scene targets and
unavoidable passages remain reachable. Held routes end at the script boundary
so the bot observes the result before continuing. This applies throughout
FireRed rather than hard-coding Cinnabar's door coordinates.

## Base campaign route

This reference lists the base campaign's scripted checkpoints in planner order.
A committed random-team run inserts its own acquisition, evolution, NPC trade,
Bicycle, Fly, HM-carrier and PC assembly steps. Only that run's steps appear in
its UI. Some base-plan choices (such as Lapras, the Coin Case or coverage TMs)
are omitted when the selected team does not use them.

### Pallet to Pewter

- **Collect Oak’s Parcel** — Visit the Viridian Poké Mart and accept the delivery for Professor Oak. Complete when: The parcel delivery scene has started.
  - Planner ID: `oak-parcel`; native criterion: `{"kind":"variable-at-least","id":16471,"value":1}`.
- **Receive the Pokédex** — Return the parcel to Oak’s lab and finish the Pokédex conversation. Complete when: The game records receipt of the Pokédex.
  - Planner ID: `regional-pokedex`; native criterion: `{"kind":"flag-set","id":2089}`.
- **Defeat the rival on Route 22** — Prepare the available team, then finish the early Route 22 rival battle. Complete when: The rival’s first Route 22 encounter is resolved.
  - Planner ID: `rival-route22-early`; native criterion: `{"kind":"variable-at-least","id":16468,"value":2}`.
- **1. Brock — Boulder Badge** — Reach Brock, prepare the battle team and win the Gym battle. Complete when: The Boulder Badge flag is set in the game.
  - Planner ID: `badge-boulder`; native criterion: `{"kind":"flag-set","id":2080}`.
### Mt. Moon and Cerulean

- **Choose a Mt. Moon fossil** — Cross Mt. Moon, defeat the fossil guard and choose a fossil. Complete when: The fossil choice is recorded.
  - Planner ID: `mt-moon-fossil`; native criterion: `{"kind":"flag-set","id":562}`.
- **Defeat the Cerulean rival** — Finish the rival encounter before continuing north toward Bill. Complete when: The Cerulean rival scene is complete.
  - Planner ID: `rival-cerulean`; native criterion: `{"kind":"variable-at-least","id":16466,"value":1}`.
- **Help Bill enter the teleporter** — Speak to Bill in Sea Cottage and agree to help. Complete when: Bill enters the machine or his rescue has already advanced.
  - Planner ID: `bill-enter-teleporter`; native criterion: `{"kind":"any","completions":[{"kind":"flag-set","id":2},{"kind":"flag-set","id":563},{"kind":"flag-set","id":564}]}`.
- **Operate Bill’s PC** — Use the cell separator after Bill enters the teleporter. Complete when: Bill is restored to his human form.
  - Planner ID: `bill-cell-separator`; native criterion: `{"kind":"any","completions":[{"kind":"flag-set","id":563},{"kind":"flag-set","id":564}]}`.
- **Receive the S.S. Ticket** — Speak to Bill again after restoring him. Complete when: Receipt of the S.S. Ticket is recorded.
  - Planner ID: `ss-ticket`; native criterion: `{"kind":"flag-set","id":564}`.
- **2. Misty — Cascade Badge** — Reach Misty, prepare the battle team and win the Gym battle. Complete when: The Cascade Badge flag is set in the game.
  - Planner ID: `badge-cascade`; native criterion: `{"kind":"flag-set","id":2081}`.
### Vermilion and the S.S. Anne

- **Clear the stolen-TM Rocket encounter** — Leave through the robbed house and defeat the Rocket behind it. Complete when: The Rocket encounter is resolved.
  - Planner ID: `cerulean-rocket`; native criterion: `{"kind":"variable-at-least","id":16509,"value":1}`.
- **Receive the Vs. Seeker** — Speak to the woman in Vermilion Pokémon Center for trainer rematches. Complete when: The Vs. Seeker is in the bag or its receipt is recorded.
  - Planner ID: `vs-seeker`; native criterion: `{"kind":"any","completions":[{"kind":"flag-set","id":658},{"kind":"item-at-least","id":362,"quantity":1}]}`.
- **Defeat the S.S. Anne rival** — Board with the ticket and finish the rival battle near the captain. Complete when: The ship’s rival scene is complete.
  - Planner ID: `rival-ss-anne`; native criterion: `{"kind":"variable-at-least","id":16475,"value":1}`.
- **Receive Cut** — Help the S.S. Anne captain and receive HM01. Complete when: The game records receipt of Cut.
  - Planner ID: `hm-cut`; native criterion: `{"kind":"flag-set","id":567}`.
- **Teach Cut** — Use the planned TM or HM on an eligible party member; Cut, Flash and Rock Smash require a utility carrier. Complete when: The planned recipient knows Cut, or the campaign’s superseding completion condition is met.
  - Planner ID: `teach-cut`; native criterion: `{"kind":"any","completions":[{"kind":"party-knows-move","moveId":15},{"kind":"flag-set","id":2082}]}`.
- **Find Surge’s first switch** — Search the gym’s bins for the first electrical switch. Complete when: The first switch is active or the gym has already been cleared.
  - Planner ID: `surge-first-lock`; native criterion: `{"kind":"any","completions":[{"kind":"flag-set","id":1},{"kind":"flag-set","id":612},{"kind":"flag-set","id":2082}]}`.
- **Open Surge’s second lock** — Find the adjacent second switch; recover if the puzzle resets. Complete when: The electrical barrier is open or the Thunder Badge is owned.
  - Planner ID: `surge-second-lock`; native criterion: `{"kind":"any","completions":[{"kind":"flag-set","id":612},{"kind":"flag-set","id":2082}]}`.
- **3. Lt. Surge — Thunder Badge** — Reach Lt. Surge, prepare the battle team and win the Gym battle. Complete when: The Thunder Badge flag is set in the game.
  - Planner ID: `badge-thunder`; native criterion: `{"kind":"flag-set","id":2082}`.
### Celadon Gym

- **Collect the Coin Case** — Speak to the man in Celadon’s restaurant. Complete when: The Coin Case is held or its receipt is recorded.
  - Planner ID: `coin-case`; native criterion: `{"kind":"any","completions":[{"kind":"flag-set","id":579},{"kind":"item-at-least","id":260,"quantity":1}]}`.
- **4. Erika — Rainbow Badge** — Reach Erika, prepare the battle team and win the Gym battle. Complete when: The Rainbow Badge flag is set in the game.
  - Planner ID: `badge-rainbow`; native criterion: `{"kind":"flag-set","id":2083}`.
### Rocket Hideout

- **Obtain Tea for the Saffron guards** — Visit the woman in Celadon Condominiums to open the Saffron gate route. Complete when: The game records receipt of Tea.
  - Planner ID: `tea`; native criterion: `{"kind":"flag-set","id":678}`.
- **Defeat the poster guard** — Battle the Rocket guarding the Game Corner poster. Complete when: The poster guard’s trainer flag is set.
  - Planner ID: `game-corner-rocket`; native criterion: `{"kind":"flag-set","id":1637}`.
- **Open the Rocket Hideout** — Inspect the poster switch after defeating its guard. Complete when: The hidden staircase is unlocked.
  - Planner ID: `rocket-hideout-poster`; native criterion: `{"kind":"flag-set","id":621}`.
- **Defeat the Lift Key guard** — Reach basement 4 and defeat the Rocket carrying the Lift Key. Complete when: The Lift Key guard’s defeat is recorded.
  - Planner ID: `rocket-hideout-lift-key-grunt`; native criterion: `{"kind":"flag-set","id":1648}`.
- **Collect the Lift Key** — Speak to the defeated guard and pick up the dropped key. Complete when: The Lift Key is present in the bag.
  - Planner ID: `rocket-hideout-lift-key`; native criterion: `{"kind":"item-at-least","id":356,"quantity":1}`.
- **Defeat Giovanni’s left guard** — Use the lift and defeat the left Rocket outside Giovanni’s room. Complete when: The left guard’s defeat is recorded.
  - Planner ID: `rocket-hideout-door-grunt-left`; native criterion: `{"kind":"flag-set","id":1646}`.
- **Defeat Giovanni’s right guard** — Defeat the other Rocket to open Giovanni’s room. Complete when: The right guard’s defeat is recorded.
  - Planner ID: `rocket-hideout-door-grunt-right`; native criterion: `{"kind":"flag-set","id":1647}`.
- **Defeat Giovanni in the hideout** — Enter the boss room with a prepared team and defeat Giovanni. Complete when: Giovanni’s hideout defeat is recorded.
  - Planner ID: `rocket-hideout-giovanni`; native criterion: `{"kind":"flag-set","id":1628}`.
- **Collect the Silph Scope** — Pick up the Silph Scope left in Giovanni’s room. Complete when: The Silph Scope is present in the bag.
  - Planner ID: `silph-scope`; native criterion: `{"kind":"item-at-least","id":359,"quantity":1}`.
- **Leave the Rocket Hideout** — Return through the lift and exit to Celadon. Complete when: The player is outside the hideout.
  - Planner ID: `rocket-hideout-exit`; native criterion: `{"kind":"map-not-in","maps":["MAP_ROCKET_HIDEOUT_B1F","MAP_ROCKET_HIDEOUT_B2F","MAP_ROCKET_HIDEOUT_B3F","MAP_ROCKET_HIDEOUT_B4F","MAP_ROCKET_HIDEOUT_ELEVATOR"]}`.
### Pokémon Tower

- **Defeat the Pokémon Tower rival** — Finish the rival battle on the tower’s second floor. Complete when: The Pokémon Tower rival scene is complete.
  - Planner ID: `rival-pokemon-tower`; native criterion: `{"kind":"variable-at-least","id":16477,"value":1}`.
- **Rescue Mr. Fuji** — Use the Silph Scope, resolve the Marowak encounter, clear the upper Rockets and speak to Mr. Fuji. Complete when: Mr. Fuji’s rescue is recorded.
  - Planner ID: `mr-fuji`; native criterion: `{"kind":"flag-set","id":572}`.
- **Receive the Poké Flute** — Speak to Mr. Fuji at the volunteer Pokémon house. Complete when: Receipt of the Poké Flute is recorded.
  - Planner ID: `poke-flute`; native criterion: `{"kind":"flag-set","id":573}`.
### Silph Co.

- **Collect the Silph Card Key** — Reach Silph Co. floor 5 and collect the Card Key. Complete when: The Card Key is present in the bag.
  - Planner ID: `silph-card-key`; native criterion: `{"kind":"item-at-least","id":355,"quantity":1}`.
- **Open the first floor-3 card door** — Use the Card Key on the first required third-floor door. Complete when: This card door’s unlock flag is set.
  - Planner ID: `silph-third-floor-door-two`; native criterion: `{"kind":"flag-set","id":637}`.
- **Open the floor-3 teleporter route** — Unlock the other required third-floor door and reach the warp tile. Complete when: The teleporter-route door is unlocked.
  - Planner ID: `silph-third-floor-door`; native criterion: `{"kind":"flag-set","id":636}`.
- **Buy the planned coverage TM** — Obtain Secret Power if this team’s plan requires it. Complete when: The TM is available or a party member already knows the move.
  - Planner ID: `silph-coverage-tm`; native criterion: `{"kind":"any","completions":[{"kind":"item-at-least","id":331,"quantity":1},{"kind":"party-knows-move","moveId":290}]}`.
- **Teach Secret Power** — Use the planned TM or HM on an eligible party member; Cut, Flash and Rock Smash require a utility carrier. Complete when: The planned recipient knows Secret Power, or the campaign’s superseding completion condition is met.
  - Planner ID: `teach-secret-power`; native criterion: `{"kind":"party-knows-move","moveId":290}`.
- **Silph Supplies** — Buy the planned reserve within the available budget: 8 × Hyper Potion, 4 × Full Heal, 15 × Great Ball. Complete when: The reserve is present, its later story condition is met, or no missing purchase is affordable.
  - Planner ID: `silph-supplies`; native criterion: `{"kind":"any","completions":[{"kind":"all","completions":[{"kind":"item-at-least","id":21,"quantity":8},{"kind":"item-at-least","id":23,"quantity":4},{"kind":"item-at-least","id":3,"quantity":15}]},{"kind":"variable-at-least","id":16476,"value":1}]}`.
- **Defeat the Silph Co. rival** — Follow the unlocked teleporters and win the seventh-floor rival battle. Complete when: The Silph rival scene is complete.
  - Planner ID: `rival-silph`; native criterion: `{"kind":"variable-at-least","id":16476,"value":1}`.
- **Receive Lapras** — Make party space and accept Lapras from the Silph employee. Complete when: Lapras is recorded as owned.
  - Planner ID: `gift-lapras`; native criterion: `{"kind":"owned-species","species":[131]}`.
- **Unlock the Silph president’s room** — Use the Card Key on the eleventh-floor door. Complete when: The president’s room is unlocked.
  - Planner ID: `silph-eleventh-floor-door`; native criterion: `{"kind":"flag-set","id":653}`.
- **Free Silph Co.** — Defeat Giovanni and finish the president’s-room scene. Complete when: Team Rocket’s Silph takeover is marked resolved.
  - Planner ID: `silph-liberated`; native criterion: `{"kind":"flag-set","id":83}`.
### Safari Zone and Fuchsia

- **Clear Route 12’s Snorlax** — Use the Poké Flute and catch Snorlax when the team plan calls for it. Complete when: The roadblock is cleared and the required catch is owned.
  - Planner ID: `route12-snorlax`; native criterion: `{"kind":"all","completions":[{"kind":"flag-set","id":84},{"kind":"owned-species","species":[143]}]}`.
- **Find the Gold Teeth** — Traverse the Safari Zone to the western area and collect the teeth. Complete when: Collection of the Gold Teeth is recorded.
  - Planner ID: `gold-teeth`; native criterion: `{"kind":"flag-set","id":393}`.
- **Receive Surf** — Reach the Safari Zone Secret House before the visit ends. Complete when: Receipt of HM03 Surf is recorded.
  - Planner ID: `hm-surf`; native criterion: `{"kind":"flag-set","id":569}`.
- **Receive Strength** — Return the Gold Teeth to Fuchsia’s Safari Zone warden. Complete when: Receipt of HM04 Strength is recorded.
  - Planner ID: `hm-strength`; native criterion: `{"kind":"flag-set","id":570}`.
- **Teach Surf** — Use the planned TM or HM on an eligible party member; Cut, Flash and Rock Smash require a utility carrier. Complete when: The planned recipient knows Surf, or the campaign’s superseding completion condition is met.
  - Planner ID: `teach-surf`; native criterion: `{"kind":"party-knows-move","moveId":57}`.
- **Teach Strength** — Use the planned TM or HM on an eligible party member; Cut, Flash and Rock Smash require a utility carrier. Complete when: The planned recipient knows Strength, or the campaign’s superseding completion condition is met.
  - Planner ID: `teach-strength`; native criterion: `{"kind":"party-knows-move","moveId":70}`.
- **5. Koga — Soul Badge** — Reach Koga, prepare the battle team and win the Gym battle. Complete when: The Soul Badge flag is set in the game.
  - Planner ID: `badge-soul`; native criterion: `{"kind":"flag-set","id":2084}`.
### Saffron Gym

- **6. Sabrina — Marsh Badge** — Reach Sabrina, prepare the battle team and win the Gym battle. Complete when: The Marsh Badge flag is set in the game.
  - Planner ID: `badge-marsh`; native criterion: `{"kind":"flag-set","id":2085}`.
### Pokémon Mansion and Cinnabar

- **Find the Cinnabar Gym key** — Reach Pokémon Mansion’s basement using the statue switches and the correct drop, then collect the Secret Key. Complete when: The game records collection of the Secret Key.
  - Planner ID: `secret-key`; native criterion: `{"kind":"flag-set","id":424}`.
- **Defeat Quinn** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-quinn`; native criterion: `{"kind":"flag-set","id":1493}`.
- **Defeat Erik** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-erik`; native criterion: `{"kind":"flag-set","id":1457}`.
- **Defeat Avery** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-avery`; native criterion: `{"kind":"flag-set","id":1458}`.
- **Defeat Ramon** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-ramon`; native criterion: `{"kind":"flag-set","id":1494}`.
- **Defeat Derek** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-derek`; native criterion: `{"kind":"flag-set","id":1459}`.
- **Defeat Dusty** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-dusty`; native criterion: `{"kind":"flag-set","id":1495}`.
- **Defeat Zac** — Clear this Cinnabar Gym trainer and proceed through the next gate. Complete when: This trainer’s defeat is recorded.
  - Planner ID: `cinnabar-gym-zac`; native criterion: `{"kind":"flag-set","id":1460}`.
- **7. Blaine — Volcano Badge** — Reach Blaine, prepare the battle team and win the Gym battle. Complete when: The Volcano Badge flag is set in the game.
  - Planner ID: `badge-volcano`; native criterion: `{"kind":"flag-set","id":2086}`.
### Viridian Gym

- **8. Giovanni — Earth Badge** — Reach Giovanni, prepare the battle team and win the Gym battle. Complete when: The Earth Badge flag is set in the game.
  - Planner ID: `badge-earth`; native criterion: `{"kind":"flag-set","id":2087}`.
### League gates and Victory Road

- **Defeat the final Route 22 rival** — Return to Route 22 with all eight badges and defeat the rival. Complete when: The final Route 22 rival scene is complete.
  - Planner ID: `rival-route22-late`; native criterion: `{"kind":"variable-at-least","id":16468,"value":4}`.
- **Pass the Boulder Badge gate** — Show the first badge at the Pokémon League entrance. Complete when: The first badge inspection is complete.
  - Planner ID: `route23-boulder-gate`; native criterion: `{"kind":"variable-at-least","id":16479,"value":1}`.
- **Pass the Cascade Badge gate** — Show badge 2 to its Route 23 guard. Complete when: The game records at least 2 completed badge inspections.
  - Planner ID: `route23-badge-gate-2`; native criterion: `{"kind":"variable-at-least","id":16479,"value":2}`.
- **Pass the Thunder Badge gate** — Show badge 3 to its Route 23 guard. Complete when: The game records at least 3 completed badge inspections.
  - Planner ID: `route23-badge-gate-3`; native criterion: `{"kind":"variable-at-least","id":16479,"value":3}`.
- **Pass the Rainbow Badge gate** — Show badge 4 to its Route 23 guard. Complete when: The game records at least 4 completed badge inspections.
  - Planner ID: `route23-badge-gate-4`; native criterion: `{"kind":"variable-at-least","id":16479,"value":4}`.
- **Pass the Soul Badge gate** — Show badge 5 to its Route 23 guard. Complete when: The game records at least 5 completed badge inspections.
  - Planner ID: `route23-badge-gate-5`; native criterion: `{"kind":"variable-at-least","id":16479,"value":5}`.
- **Pass the Marsh Badge gate** — Show badge 6 to its Route 23 guard. Complete when: The game records at least 6 completed badge inspections.
  - Planner ID: `route23-badge-gate-6`; native criterion: `{"kind":"variable-at-least","id":16479,"value":6}`.
- **Pass the Volcano Badge gate** — Show badge 7 to its Route 23 guard. Complete when: The game records at least 7 completed badge inspections.
  - Planner ID: `route23-badge-gate-7`; native criterion: `{"kind":"variable-at-least","id":16479,"value":7}`.
- **Pass the Earth Badge gate** — Show badge 8 to its Route 23 guard. Complete when: The game records at least 8 completed badge inspections.
  - Planner ID: `route23-badge-gate-8`; native criterion: `{"kind":"variable-at-least","id":16479,"value":8}`.
- **Open Victory Road’s first-floor barrier** — Use Strength to push the first-floor boulder onto its switch. Complete when: The first-floor switch variable confirms activation.
  - Planner ID: `victory-road-first-floor-switch`; native criterion: `{"kind":"variable-at-least","id":16484,"value":100}`.
- **Open the first second-floor barrier** — Push the western second-floor boulder onto its switch. Complete when: The first second-floor switch is active.
  - Planner ID: `victory-road-second-floor-switch-one`; native criterion: `{"kind":"variable-at-least","id":16485,"value":100}`.
- **Open the third-floor barrier** — Use Strength to activate the third-floor switch. Complete when: The third-floor switch is active.
  - Planner ID: `victory-road-third-floor-switch`; native criterion: `{"kind":"variable-at-least","id":16487,"value":100}`.
- **Drop the final Victory Road boulder** — Push the third-floor boulder through the hole to floor 2. Complete when: The game records the boulder on the lower floor.
  - Planner ID: `victory-road-drop-boulder`; native criterion: `{"kind":"flag-unset","id":88}`.
- **Open Victory Road’s exit** — Push the dropped boulder onto the final second-floor switch. Complete when: The exit barrier’s switch is active.
  - Planner ID: `victory-road-second-floor-switch-two`; native criterion: `{"kind":"variable-at-least","id":16486,"value":100}`.
### Elite Four and Champion

- **Restore the team at Indigo Plateau** — Use the Pokémon Center before entering the League. Complete when: Every party member has full HP, PP and no status, or the League attempt has begun.
  - Planner ID: `league-heal`; native criterion: `{"kind":"any","completions":[{"kind":"party-fully-restored"},{"kind":"flag-set","id":1208}]}`.
- **League Supplies** — Buy the planned reserve within the available budget: 24 × Revive, 40 × Max Potion, 8 × Full Heal, 20 × Full Restore. Complete when: The reserve is present, its later story condition is met, or no missing purchase is affordable.
  - Planner ID: `league-supplies`; native criterion: `{"kind":"any","completions":[{"kind":"all","completions":[{"kind":"item-at-least","id":24,"quantity":24},{"kind":"item-at-least","id":20,"quantity":40},{"kind":"item-at-least","id":23,"quantity":8},{"kind":"item-at-least","id":19,"quantity":20}]},{"kind":"flag-set","id":1208}]}`.
- **Defeat Lorelei** — Enter the next League room with the prepared team and finish the battle. Complete when: This Elite Four member’s defeat flag is set for the current League attempt.
  - Planner ID: `elite-four-lorelei`; native criterion: `{"kind":"flag-set","id":1208}`.
- **Restore the team after Lorelei** — Revive and heal the whole party, cure status, restore PP where supplies allow, then save before continuing. Complete when: Available recovery is complete or the following League battle is already cleared.
  - Planner ID: `restore-after-lorelei`; native criterion: `{"kind":"any","completions":[{"kind":"party-maximally-recovered"},{"kind":"flag-set","id":1209}]}`.
- **Defeat Bruno** — Enter the next League room with the prepared team and finish the battle. Complete when: This Elite Four member’s defeat flag is set for the current League attempt.
  - Planner ID: `elite-four-bruno`; native criterion: `{"kind":"flag-set","id":1209}`.
- **Restore the team after Bruno** — Revive and heal the whole party, cure status, restore PP where supplies allow, then save before continuing. Complete when: Available recovery is complete or the following League battle is already cleared.
  - Planner ID: `restore-after-bruno`; native criterion: `{"kind":"any","completions":[{"kind":"party-maximally-recovered"},{"kind":"flag-set","id":1210}]}`.
- **Defeat Agatha** — Enter the next League room with the prepared team and finish the battle. Complete when: This Elite Four member’s defeat flag is set for the current League attempt.
  - Planner ID: `elite-four-agatha`; native criterion: `{"kind":"flag-set","id":1210}`.
- **Restore the team after Agatha** — Revive and heal the whole party, cure status, restore PP where supplies allow, then save before continuing. Complete when: Available recovery is complete or the following League battle is already cleared.
  - Planner ID: `restore-after-agatha`; native criterion: `{"kind":"any","completions":[{"kind":"party-maximally-recovered"},{"kind":"flag-set","id":1211}]}`.
- **Defeat Lance** — Enter the next League room with the prepared team and finish the battle. Complete when: This Elite Four member’s defeat flag is set for the current League attempt.
  - Planner ID: `elite-four-lance`; native criterion: `{"kind":"flag-set","id":1211}`.
- **Restore the team after Lance** — Revive and heal the whole party, cure status, restore PP where supplies allow, then save before continuing. Complete when: Available recovery is complete or the following League battle is already cleared.
  - Planner ID: `restore-after-lance`; native criterion: `{"kind":"any","completions":[{"kind":"party-maximally-recovered"},{"kind":"flag-set","id":2092}]}`.
- **Defeat the Champion and enter the Hall of Fame** — Finish the Champion battle, registration and the game’s completion sequence. Complete when: The cartridge’s game-clear flag is set; the run additionally verifies the committed Hall of Fame team and save.
  - Planner ID: `champion`; native criterion: `{"kind":"flag-set","id":2092}`.

## Conditional Sevii interlude

If Bill’s initial island trip is active, these steps take priority before the
regular campaign continues. They are not required for an unentered trip.

- **Sail to Two Island** — If Bill’s island trip has started, take the ferry to Two Island. Complete when: Two Island is recorded as visited.
- **Learn about Lostelle** — Speak to the father in Two Island’s Game Corner. Complete when: The Lostelle search scene has started.
- **Sail to Three Island** — Take the ferry to Three Island to follow the search. Complete when: Three Island is recorded as visited.
- **Confront the Three Island bikers** — Approach the bikers and finish their initial scene. Complete when: The confrontation has advanced to the battle stage.
- **Defeat the biker group** — Accept the confrontation and finish all biker battles. Complete when: The biker encounter is resolved.
- **Rescue Lostelle in Berry Forest** — Cross Bond Bridge, reach Lostelle and resolve the Hypno encounter. Complete when: Lostelle’s rescue is recorded.
- **Deliver the Meteorite** — Return to the Game Corner and complete the delivery conversation. Complete when: The island errand has reached its return stage.
- **Return to One Island** — Take the ferry back to One Island. Complete when: The player reaches One Island.
- **Finish Bill and Celio’s island trip** — Return to One Island Pokémon Center and complete the trip’s closing scene. Complete when: The game marks the introductory island trip complete.

## Verification limits

The regression gate covers preserved native failures, restart/handoff behavior,
and the wider engine and host suites. It does not certify that every possible
random team has completed a full fresh run without intervention. The current
run retains its original save, team and intervention history. No gameplay ROM
patch, badge, inventory or party-memory write is used by this change.

Game reference: [Serebii’s FireRed/LeafGreen gyms](https://www.serebii.net/fireredleafgreen/gyms.shtml).
Interface references: Apple’s [layout](https://developer.apple.com/design/human-interface-guidelines/layout) and [disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls).
