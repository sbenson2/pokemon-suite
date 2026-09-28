import Foundation

public struct ActivityFact: Identifiable, Equatable {
    public let label: String
    public let value: String
    public var id: String { label }
}

public enum ActivityAttention {
    case none, routeUnavailable, review
}

public struct ActivityDecision: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let reason: String?
    public let location: String?
    public let date: Date?
    public let frame: String?
    public var repeats: Int
    public let buttons: String?
    public let evidence: [String]
    public let constraints: [String]
}

/// Read-only explanations of published telemetry. No inferred HP damage, ETA,
/// success receipt, or remembered action is substituted for current evidence.
public struct ActivityPresentation {
    public private(set) var status = "Bot running"
    public private(set) var symbol = "play.circle"
    public private(set) var attention: ActivityAttention = .none
    public var needsAttention: Bool { attention != .none }
    public private(set) var stale = false
    public private(set) var now = "Reading game state"
    public private(set) var why: String?
    public private(set) var next: String?
    public private(set) var goal: String?
    public private(set) var goalProgress: ActivityFact?
    public private(set) var location: String?
    public private(set) var destination: String?
    public private(set) var updatedAt: Date?
    public private(set) var freshness = "Update time unavailable"
    public private(set) var facts: [ActivityFact] = []
    public private(set) var metrics: [ActivityFact] = []
    public private(set) var diagnostics: [ActivityFact] = []
    public private(set) var decisions: [ActivityDecision] = []
    /// Goal, task, plan and route behind the current action.
    public private(set) var outline = ActivityOutline()
    /// The newest published action while the current sample is only a wait.
    public private(set) var latestAction: String?
    /// Why a stopped or recovering owner stopped, and a proven-safe fix when there is one (L1.1).
    public private(set) var triage: StopTriage?
    /// One line for headers: the long-running goal and the task serving it.
    public var headline: String? {
        guard let goal = outline.goal?.title else { return outline.task?.title ?? self.goal }
        return outline.task.map { "\(goal) · \($0.title)" } ?? goal
    }

    public init(session s: JSONValue, catalog: JSONValue = .null, connected: Bool = true, now date: Date) {
        let campaign = s["campaign"], bot = s["bot"]
        let prep = bot["preparation"], mission = s["mission"]
        let postgame = s["postgame"]
        let postgameActive = bot["runScope"].string == "postgame"
        // Completed campaign telemetry remains in the session during postgame.
        // It is history, not the owner of the current action or explanation.
        let story: JSONValue = postgameActive ? .null : campaign["storyProgress"]
        let task: JSONValue = postgameActive ? .null : campaign["task"].isNull ? s["spectator"]["strategy"]["campaign"]["activeTask"] : campaign["task"]
        let deferredMission = postgameActive && bot["activity"].string == "postgame" && mission["state"].string == "blocked"
        let terminal:Set<String>=["complete","completed","cancelled","idle"]
        let decision = s["decision"], winner = s["winner"].isNull ? s["spectator"]["strategy"]["decision"] : s["winner"]
        let action: JSONValue = decision["kind"].string == "resample" ? .null : decision["recommendation"].isNull ? winner["recommendation"] : decision["recommendation"]
        let objective = postgameActive || task["objective"].isNull ? bot["objective"] : task["objective"]
        let battle = (s["mode"].string.nonempty ?? s["observation"]["mode"].string) == "battle"
        let objectiveID = action["objective"].string.nonempty ?? objective["id"].string
        let current = story["current"]
        // A finished or deferred hunt is history; it never names the current goal.
        let liveMission = !deferredMission && !terminal.contains(mission["state"].string) ? mission["name"].string.nonempty : nil
        goal = Self.checkpoint(current) ?? bot["objective"]["label"].string.nonempty ?? bot["objective"]["name"].string.nonempty ?? liveMission
        if postgameActive {
            goal = postgame["entries"].array.first { $0["id"] == postgame["active"] }?["label"].string.nonempty
                ?? liveMission
        }
        location = s["spectator"]["map"]["name"].string.nonempty ?? Self.place(s["map"]) ?? Self.place(s["observation"]["map"]["id"])
        destination = Self.place(action["targetMap"]) ?? Self.place(objective["target"]["map"])
        updatedAt = Self.date(s["updatedAt"].string)
        if let updatedAt {
            let age=max(0,date.timeIntervalSince(updatedAt))
            freshness=age < 5 ? "Updated just now" : age < 60 ? "Updated \(Self.count(age))s ago" : "Updated \(Self.count(age/60))m ago"
        }
        next = Self.checkpoint(story["next"])
        if let id = action["objective"].string.nonempty {
            let entries = story["chapters"].array.flatMap { $0["entries"].array }
            why = entries.first { $0["id"].string == id }?["detail"].string.nonempty
        }
        why = why ?? Self.reason(action, winner: winner) ?? current["detail"].string.nonempty
        now = Self.action(action, catalog: catalog, party: s["spectator"]["party"].array)
            ?? (battle ? "Finishing the current battle" : current.isNull ? "Reading game state" : "Continuing the story")

        if task["kind"].string == "recovery" || objectiveID.hasPrefix("recover-party") {
            let center = destination ?? "a Pokémon Center"
            now = battle ? "Finishing a battle before healing" : "Returning to \(center)"
            let party = s["spectator"]["party"].array
            let fainted = party.filter { $0["hp"].finiteNumber == 0 && $0["maxHp"].int > 0 }.compactMap { $0["speciesName"].string.nonempty }
            let hurt = party.first { $0["hp"].int > 0 && $0["hp"].int < $0["maxHp"].int }
            why = !fainted.isEmpty ? fainted.joined(separator: ", ") + (fainted.count == 1 ? " has fainted." : " have fainted.")
                : hurt.map { "\($0["speciesName"].string.nonempty ?? "A party member") has \($0["hp"].text)/\($0["maxHp"].text) HP. The team is scheduled for recovery." }
                    ?? "The team needs health, status or PP recovery before continuing."
            next = battle ? "Continue to \(center)." : goal.map { "Resume: \($0)." }
        } else if task["kind"].string == "training" || !objective["trainingSpecies"].isNull {
            let training=s["spectator"]["strategy"]["training"]
            let member = s["spectator"]["party"].array.first { $0["speciesId"].int == objective["trainingSpecies"].int }
            let name = training["pokemon"]["name"].string.nonempty ?? member?["speciesName"].string.nonempty ?? Self.species(objective["trainingSpecies"], catalog: catalog)
            now = "Training \(name)"
            let level=Self.number(training["pokemon"]["level"]) ?? member.flatMap { Self.number($0["level"]) }
            if let target = Self.number(training["nextLevel"]) ?? Self.number(task["minimumLevel"]) ?? Self.number(objective["minimumTeamAnchorLevel"]) {
                why = "\(name)\(level.map { " is level \($0)" } ?? " needs more experience"); the current preparation target is level \(target)."
            } else { why = "Preparing the assigned party member for the current objective." }
            if let target=Self.number(training["targetLevel"]) ?? Self.number(task["targetLevel"]) { facts.append(.init(label:"Preparation target",value:"Level \(target)")) }
            Self.counter("XP to next level",training["pokemon"]["experienceRemaining"],into:&facts)
            if task["rotation"].string == "one-level" || training["rotation"].string == "one-level" {
                next = "Recheck the team’s levels after this level."
            } else if current["id"].string.hasSuffix("evolve-train") {
                next = Self.checkpoint(story["next"]) ?? "Recheck the evolution requirements."
            } else { next = goal.map { "Resume: \($0)." } }
            if let actionText = Self.action(action, catalog: catalog, party: s["spectator"]["party"].array) { facts.append(.init(label: "Current action", value: actionText)) }
        } else if objective["incomePreparation"].bool || objectiveID.hasPrefix("fund-capture-supplies") {
            now = "Earning money for supplies"
            why = "Preparing trainer battles to earn the money needed for supplies."
            next = "Recheck the available money before buying supplies."
        } else if objectiveID.hasPrefix("battle-medicine") || objectiveID.contains("capture-supplies") {
            now = action["kind"].string == "move-toward" ? "Travelling to \(destination ?? "the Poké Mart")" : "Buying battle supplies"
            why = objectiveID.hasPrefix("battle-medicine") ? "Restocking medicine before \(goal ?? "the next major battle")." : "Restocking Poké Balls for the planned catch."
            next = goal.map { "Resume: \($0)." }
        }

        if objectiveID == "restore-postgame-party-with-items" {
            now = battle ? "Finishing the battle before restoring the party" : "Restoring the party with items"
            why = "Using medicine from the Bag so the task can continue without a trip to a Pokémon Center."
        }
        if objectiveID == "postgame-togepi-hatch" {
            now = "Walking to hatch Togepi"
            why = "Repeated walking adds the steps needed to hatch the egg."
            next = "Verify Togepi has hatched and save the game."
        }
        if !mission.isNull, !deferredMission, !terminal.contains(mission["state"].string), bot["runScope"].string != "campaign" || campaign.isNull {
            let name = mission["name"].string.nonempty ?? Self.species(mission["speciesId"], catalog: catalog)
            let phase = mission["phase"].string
            if phase.contains("sav") { now = "Saving \(name)"; next = "Verify the caught Pokémon in the saved game." }
            else if mission["protected"].bool || phase.contains("captur") { now = "Catching \(name)"; next = "Finish the catch and verify its in-game save." }
            else if phase.contains("rng") || phase.contains("timing") { now = "Timing the \(name) encounter"; next = "Verify the encounter, then catch the Pokémon." }
            else { now = "Hunting \(mission["shiny"].string == "required" ? "shiny " : "")\(name)"; next = "Check each encounter and capture the target." }
            why = mission["reason"].string.nonempty ?? mission["rng"]["reason"].string.nonempty
                ?? (mission["protected"].bool ? "A shiny is protected through capture and saving." : "Following the selected hunt using \(HuntProgress.methodName(mission["rng"]["method"].string.nonempty ?? mission["method"].string).lowercased()).")
            if mission["method"].string == "roamer" && phase == "tracking" {
                now = "Tracking \(name)"
                why = "Crossing between Pallet Town and Route 1 moves \(name). The bot searches the grass when it is on Route 1."
                next = "Find \(name), catch it, then verify the in-game save."
            } else { destination = Self.place(mission["route"]) ?? destination }
            facts.append(.init(label: "Hunt method", value: HuntProgress.methodName(mission["rng"]["method"].string.nonempty ?? mission["method"].string.nonempty ?? "automatic")))
            if mission["protected"].bool { facts.append(.init(label:"Shiny protection",value:"Capture and save in progress")) }
            if let progress = HuntProgress(session:s, nowMilliseconds:date.timeIntervalSince1970 * 1000) {
                Self.durationFact("Hunt time", progress.elapsedMilliseconds, into:&facts)
                Self.durationFact("Current hunt stage", progress.phaseMilliseconds, into:&facts)
            }
            Self.counter("Encounters", mission["encounters"], into:&facts)
            Self.counter("Resets", mission["resets"], into:&facts)
            Self.ratio("Caught this hunt", mission["caught"], mission["quantity"], into:&facts)
            Self.ratio("Timing inputs", mission["rng"]["completed"], mission["rng"]["total"], into:&facts)
            if let seconds = mission["rng"]["estimatedSeconds"].finiteNumber { Self.durationFact("Estimated timing plan",seconds * 1000,into:&facts) }
        }
        var evolving: String?
        let dexTarget = postgame["workflows"]["dex"]["target"]
        let dexEvolution = postgameActive && objective["identityEvolution"].bool
            && !terminal.contains(prep["phase"].string) && dexTarget["method"].string == "evolution"
        if dexEvolution {
            let entry = postgame["collection"].array.first { $0["speciesId"] == dexTarget["speciesId"] }
            let sourceID = entry?["fromSpecies"] ?? objective["coreSpecies"].array.first ?? .null
            let source = s["spectator"]["party"].array.first { $0["speciesId"] == sourceID }?["speciesName"].string.nonempty
                ?? Self.species(sourceID, catalog: catalog)
            let target = catalog["species"].array.first { $0["id"] == dexTarget["speciesId"] }?["name"].string.nonempty
                ?? entry?["name"].string.nonempty.map(readableGameText) ?? Self.species(dexTarget["speciesId"], catalog: catalog)
            let saving=objective["target"]["kind"].string == "save-game"
            goal = saving ? "Verify \(target)’s evolution and save" : "Evolve \(source) into \(target)"
            evolving = "\(source) is evolving into \(target)"
            let friendship = objective["target"]["kind"].string == "friendship-walk"
            let progress = prep["progress"]
            Self.ratio(friendship ? "Friendship" : "Evolution level", progress[friendship ? "friendship" : "level"], progress["required"], into: &facts)
            goalProgress = facts.last { ["Friendship", "Evolution level"].contains($0.label) }
            if let required = Self.number(progress["required"]) {
                why = friendship ? "Raising \(source)’s friendship toward \(required) before the required level-up."
                    : "Training \(source) toward level \(required) for the planned evolution."
            } else { why = "Completing \(source)’s evolution requirements." }
            if saving { now = "Saving \(target)";why = "The evolved Pokémon still needs a verified in-game save." }
            else if friendship && !battle { now = "Walking to raise \(source)’s friendship" }
            else if action.isNull { now = battle ? "Finishing the current battle" : "Checking \(source)’s evolution progress" }
            next = "Verify \(target) has evolved and confirm its in-game save."
        } else if prep["kind"].string == "ev-training", !terminal.contains(prep["phase"].string) {
            now = "Training the selected Pokémon’s EVs"
            why = "Fighting encounters whose EV yield fits the requested spread."
            next = "Verify every EV target and save the Pokémon."
            for (key,label) in [("hp","HP"),("attack","Attack"),("defense","Defense"),("spAttack","Sp. Attack"),("spDefense","Sp. Defense"),("speed","Speed")] {
                Self.ratio(label + " EVs",prep["progress"]["current"][key],prep["progress"]["target"][key],into:&facts)
            }
        } else if prep["kind"].string == "evolution" && !terminal.contains(prep["phase"].string) || !s["localEvolution"].isNull && !terminal.contains(s["localEvolution"]["phase"].string) {
            let evolution = s["localEvolution"].isNull ? prep : s["localEvolution"]
            now = "Preparing the requested evolution"
            why = evolution["reason"].string.nonempty ?? prep["reason"].string.nonempty ?? "Completing the evolution’s game requirements."
            next = "Verify the evolved Pokémon and its save."
            Self.ratio("Evolution level",prep["progress"]["level"],prep["progress"]["required"],into:&facts)
        } else if !terminal.contains(prep["phase"].string) {
            switch prep["kind"].string {
            case "save":now="Saving the game";why="Completing your save request through the game menu.";next="Verify that the in-game save completed."
            case "heal":now=battle ? "Finishing a battle before healing" : "Healing the team";why="Restoring the party’s health, status and PP.";next="Verify recovery and wait for your next task."
            case "travel":now=destination.map { "Travelling to \($0)" } ?? now;why="Following your requested destination.";next="Verify arrival and wait for your next task."
            case "item":why="Collecting the item requested in Bot settings."
            default:break
            }
        }
        let trade = s["tradeTask"].isNull ? s["nativeTrade"] : s["tradeTask"]
        if !trade.isNull, !["complete","completed","cancelled","idle"].contains(trade["phase"].string) {
            now = trade["exchangeStarted"].bool ? "Completing the trade" : "Preparing the trade lobby"
            why = trade["reason"].string.nonempty ?? "Following the game’s trade sequence."
            next = trade["exchangeStarted"].bool ? "Wait for both games to finish and return to the lobby." : "Wait for a partner to join and accept the trade."
            facts.append(.init(label:"Trade stage",value:readableGameText(trade["phase"].string)))
        }

        if let steps = Self.number(action["remainingSteps"]) { facts.append(.init(label:"Route remaining",value:"\(steps) planned steps")) }
        let matchup=s["spectator"]["strategy"]["battle"]
        if battle { for (key,label) in [("player","Battling with"),("opponent","Opponent")] {
            let pokemon=matchup[key]
            if let name=pokemon["name"].string.nonempty {
                var value=name
                if let level=Self.number(pokemon["level"]) { value += " Lv. \(level)" }
                if let hp=Self.number(pokemon["hp"]),let maximum=Self.number(pokemon["maxHp"]) { value += ", \(hp)/\(maximum) HP" }
                if let status=pokemon["status"].string.nonempty,status != "OK" { value += " (\(status))" }
                facts.append(.init(label:label,value:value))
            }
        } }
        if let via = Self.place(action["transit"]["destinationMap"]) { facts.append(.init(label:"Via",value:via)) }
        if let label = goal,!story["current"].isNull { facts.append(.init(label:"Story checkpoint",value:label)) }
        Self.ratio("Story checkpoints",story["completed"],story["total"],into:&facts)
        if story["badges"]["known"].int > 0 { Self.ratio("Verified badges",story["badges"]["earned"],story["badges"]["total"],into:&facts) }
        if let completion = current["completion"].string.nonempty { facts.append(.init(label:"Checkpoint complete when",value:completion)) }
        Self.counter("Measured XP/min",campaign["training"]["measuredXpPerMinute"],into:&facts)
        Self.counter("Estimated XP/min",campaign["training"]["estimatedXpPerMinute"],into:&facts)
        let storage = s["storage"]
        if storage["known"].bool {
            Self.ratio("PC boxes",storage["pcUsed"],storage["pcCapacity"],into:&facts)
            Self.counter("Free storage spaces",storage["free"],into:&facts)
            Self.counter("Reserved spaces",storage["reserveSlots"],into:&facts)
            Self.counter("Available for catches",storage["captureBudget"],into:&facts)
        }
        let collection = s["collectionRun"]
        if postgameActive {
            Self.ratio("Postgame goals", postgame["progress"]["completed"], postgame["progress"]["total"], into:&facts)
            // Agenda idle time is meaningful only while the agenda owns the task.
            // A dispatched hunt has its own timer and may intentionally repeat movement.
            if bot["activity"].string == "postgame" {
                Self.durationFact("Without task progress",postgame["semantic"]["idleMs"].finiteNumber,into:&facts)
            }
            // An expired retry no longer defers the entry; the agenda may run it again.
            for entry in postgame["entries"].array where entry["status"].string != "complete" && !entry["retry"].isNull
                && entry["retry"]["retryAt"].finiteNumber.map({ $0 / 1000 > date.timeIntervalSince1970 }) != false {
                let label = entry["label"].string.nonempty ?? "Postgame task"
                let reason = Self.explainStop(entry["retry"]["reason"].string)
                facts.append(.init(label:"Deferred: \(label)",value:"\(label): \(reason)"))
            }
        }
        Self.ratio("Owned shiny entries",collection["dexProgress"]["owned"],collection["dexProgress"]["total"],into:&facts)
        if let reason = collection["reason"].string.nonempty { facts.append(.init(label:"Collection",value:reason)) }
        for (label,key) in [("Battles","battles"),("Trainer battles","trainerBattles"),("Wild battles","wildBattles"),("Captures","captures"),("Trades","trades"),("Heals","heals"),("Steps","steps"),("Evolutions","evolutions")] {
            Self.counter(label,s["spectator"]["progress"][key],into:&metrics)
        }
        Self.durationFact("Active bot time",campaign["supervision"]["elapsedMs"].finiteNumber,into:&metrics)
        let play = s["spectator"]["trainer"]["playTime"]
        if let hours=play["hours"].finiteNumber,let minutes=play["minutes"].finiteNumber,let seconds=play["seconds"].finiteNumber {
            Self.durationFact("In-game play time",(hours * 3600 + minutes * 60 + seconds) * 1000,into:&metrics)
        }
        Self.durationFact("Since last progress",campaign["supervision"]["idleMs"].finiteNumber,into:&diagnostics)
        Self.durationFact("Progress timeout",campaign["supervision"]["progressTimeoutMs"].finiteNumber,into:&diagnostics)
        for (label,v) in [("Session",s["sessionId"]),("Run",campaign["label"]),("Frame",s["frame"]),("Game mode",s["mode"]),("Checkpointed frame",s["save"]["frame"])] {
            if !v.isNull, v.text != "" { diagnostics.append(.init(label:label,value:v.text)) }
        }
        if let saved = Self.date(s["save"]["updatedAt"].string) { diagnostics.append(.init(label:"Emulator checkpoint",value:saved.formatted(date:.omitted,time:.standard))) }
        Self.counter("In-game saves",s["spectator"]["progress"]["savedGame"],into:&diagnostics)
        for package in s["runtime"]["lock"]["packages"].array { if let version=package["version"].string.nonempty { diagnostics.append(.init(label:"\(readableGameText(package["kind"].string)) version",value:version)) } }
        if s["runtime"]["qualification"]["pinned"].bool { diagnostics.append(.init(label:"Campaign qualification",value:"Engine pinned; \(s["runtime"]["qualification"]["interventions"].array.count) interventions")) }
        if let retry=campaign["supervision"]["reviewedRetries"].finiteNumber { diagnostics.append(.init(label:"Reviewed retries",value:Self.count(retry))) }
        if let reason=s["recovery"]["reason"].string.nonempty { diagnostics.append(.init(label:"Recovery",value:reason)) }
        if let reason=s["runtime"]["update"]["boundary"]["reason"].string.nonempty, s["runtime"]["update"]["held"].bool { diagnostics.append(.init(label:"Pending update",value:reason)) }
        decisions = Self.history(s["decisionFeed"]["entries"].array,catalog:catalog,party:s["spectator"]["party"].array)

        let tradeProblem = !trade["reason"].string.isEmpty && ["unavailable","unresolved","mismatch","incomplete","unknown"].contains { trade["phase"].string.contains($0) }
        let blocked = tradeProblem || decision["kind"].string == "blocked" || action["kind"].string == "stop-for-review" || [s["state"].string,bot["status"].string,postgameActive ? "" : campaign["status"].string,deferredMission ? "" : mission["state"].string].contains { ["blocked","failed","stopped-for-review"].contains($0) }
        let stopped = ["offline","closed"].contains(s["state"].string)
        stale = !connected || s["state"].string == "reconnecting" || (!stopped && updatedAt.map { date.timeIntervalSince($0) > 15 } == true)
        triage = stale || stopped ? nil : StopTriage(session: s)
        if s["sessionId"].string.isEmpty || (stopped && connected) {
            status = s["sessionId"].string.isEmpty ? "No game loaded" : "Game stopped"; symbol="stop.circle"
            now="Start a game to see bot activity";why=nil;next=nil
        } else if stale {
            status="Waiting for telemetry";symbol="wifi.exclamationmark"
            now="Waiting for a fresh game update";why="The details below are the last reported state. The game may still be running.";next="Reconnect to the host to receive current activity."
            if !connected { freshness = "Disconnected · " + freshness }
        } else if blocked || !s["commandError"].isNull {
            status="Needs review";symbol="exclamationmark.circle";attention = .review;now="The bot needs a review"
            let botStopped=[s["state"].string,bot["status"].string].contains { ["blocked","failed","stopped-for-review"].contains($0) }
                || decision["kind"].string == "blocked" || action["kind"].string == "stop-for-review"
            let botReason=botStopped ? Self.publishedReason(action["reason"]) ?? bot["reason"].string.nonempty ?? Self.publishedReason(decision["reason"]) : nil
            let campaignReason = !postgameActive && ["blocked","failed","stopped-for-review"].contains(campaign["status"].string) ? campaign["reason"].string.nonempty : nil
            let missionReason = !deferredMission && ["blocked","failed","stopped-for-review"].contains(mission["state"].string) ? mission["reason"].string.nonempty : nil
            why=(tradeProblem ? trade["reason"].string.nonempty : nil) ?? s["commandError"].string.nonempty ?? s["commandError"]["message"].string.nonempty ?? botReason ?? campaignReason ?? missionReason ?? "The bot stopped without publishing a detailed reason."
            next="Review the stop report in Bot settings."
            if let why { diagnostics.append(.init(label:"Stop reason",value:why)) }
            why = why.map(Self.explainStop)
        } else if s["control"]["mode"].string == "manual" {
            status="Manual play";symbol="gamecontroller";now="You control the game";why="The bot is not issuing inputs.";next="End manual play to return control to the bot."
        } else if bot["awaitingCommand"].bool {
            status="Ready for a command";symbol="checkmark.circle";now="Waiting for your next task";why=nil;next="Choose a task in Bot settings."
        } else if !bot["enabled"].bool {
            status="Bot paused";symbol="pause.circle";now="Automation is paused";why=bot["reason"].string.nonempty;next="Resume the bot from Bot settings."
        } else if action["kind"].string == "wait-for-supported-objective" {
            status="Route unavailable";symbol="exclamationmark.circle";attention = .routeUnavailable
            now="Waiting for a usable route"
            why="The planner has no supported next action from this location."
            next="The recovery check may retry or defer this task."
        } else if bot["status"].string == "recovering" && (["retry", "recovering", "draining"].contains(bot["progress"]["status"].string) || (bot["progress"]["status"].string != "temporarily-blocked" && Self.publishedReason(bot["reason"]) != nil)) {
            status="Recovering automatically";symbol="arrow.clockwise"
            let finishingInteraction=bot["progress"]["status"].string == "draining"
            now=finishingInteraction ? "Finishing the interaction before recovery" : "Rechecking the route and game state"
            why=Self.publishedReason(bot["reason"]) ?? Self.publishedReason(bot["progress"]["reason"]) ?? Self.publishedReason(decision["reason"]) ?? "The bot is checking recovery before continuing the task."
            next=finishingInteraction ? "Reach a safe state, then save or defer the task." : "Retry or defer the task after the recovery check."
        } else if (s["mode"].string.nonempty ?? s["observation"]["mode"].string) == "evolution" {
            status="Evolution in progress";symbol="sparkles"
            now=evolving ?? "A Pokémon is evolving"
            why="The game is playing the evolution scene. The bot waits for it to finish, then verifies the new Pokémon."
        } else if decision["kind"].string == "resample" && battle {
            // Party order does not identify the active battler; training switches members.
            status="In battle";symbol="bolt.circle"
            now=dexEvolution || task["kind"].string == "training" ? "Training battle in progress" : "Battle in progress"
            why=dexEvolution ? why : Self.waitingReason(decision["reason"]) ?? why
        } else if decision["kind"].string == "resample" {
            status="Waiting for the game";symbol="hourglass"
            // A task-specific explanation outlives a brief wait; generic ones do not.
            let generic=["Reading game state","Continuing the story","Finishing the current battle"].contains(now)
            if generic { now="Waiting for the next game observation" }
            let waitReason=Self.waitingReason(decision["reason"]) ?? Self.publishedReason(bot["progress"]["reason"]) ?? "Waiting for the current game interaction to finish."
            why=dexEvolution ? [waitReason, why].compactMap { $0 }.joined(separator:" ") : generic ? waitReason : why ?? waitReason
        }
        if why == nil && status == "Bot running" { why=Self.publishedReason(decision["reason"]) ?? "The bot has not published a reason for this action." }
        outline = ActivityOutline(session:s,catalog:catalog,now:date)
        if status == "Waiting for the game", let latest=decisions.first, let at=latest.date {
            let age=max(0,date.timeIntervalSince(at))
            if age < 120 { latestAction="\(latest.title) · \(age < 5 ? "just now" : "\(Self.count(age))s ago")" }
        }
    }

    /// Resample reasons are internal codes; only explained ones are shown.
    private static func waitingReason(_ value: JSONValue) -> String? {
        guard let reason=publishedReason(value) else { return nil }
        if reason.range(of:"^[a-z0-9]+(-[a-z0-9]+)+$",options:.regularExpression) == nil { return reason }
        return ["hunt-battle-transition":"Waiting for the battle to advance.","unreadable-encounter":"Reading the new encounter.",
                "policy-veto":"Holding back an unsafe input until the game state is clear."][reason]
    }

    private static func publishedReason(_ value: JSONValue) -> String? {
        guard let reason=value.string.nonempty, reason != "policy-resolution" else { return nil }
        // The evolution controller publishes this during training transitions too;
        // it does not establish that an evolution animation is on screen.
        if ["transition", "Waiting for the evolution observation."].contains(reason) {
            return "Waiting for the current game interaction to finish."
        }
        return reason
    }

    private static func explainStop(_ reason:String) -> String {
        switch reason {
        case "repeated-navigation-cycle": return "The route repeated or stopped moving without progress."
        case "unexpected-hunt-battle-menu": return "The bot found a game menu it could not safely handle."
        default: return reason
        }
    }

    private static func action(_ a: JSONValue, catalog: JSONValue, party: [JSONValue]) -> String? {
        let target = place(a["targetMap"])
        switch a["kind"].string {
        case "move-toward": return target.map { "Travelling to \($0)" } ?? "Following the route"
        case "choose-battle-move":
            let id=a["targetMoveId"]
            let name=catalog["moves"].array.first { $0["id"] == id }?["name"].string.nonempty ?? "Move \(id.text)"
            return "Using \(name)"
        case "choose-battle-command": return ["fight":"Choosing a battle move","bag":"Opening the Bag in battle","pokemon":"Choosing a Pokémon to switch in","run":"Leaving the wild encounter"][a["targetCommand"].string] ?? "Choosing a battle action"
        case "choose-party-member":
            let name=party.first { $0["slot"] == a["targetPartySlot"] }?["speciesName"].string.nonempty ?? species(a["targetSpecies"],catalog:catalog)
            return "Selecting \(name)"
        case "choose-party-action":return "Choosing \(readableGameText(a["targetAction"].string)) for the selected Pokémon"
        case "acknowledge-cartridge-prompt":return a["objective"].string.contains("battle") ? "Advancing battle dialogue" : "Advancing game dialogue"
        case "cancel-battle-move-for-run":return "Leaving the move menu to escape"
        case "cancel-conflicting-menu":return "Closing the current menu"
        case "choose-start-menu-item":return "Opening \(readableGameText(a["targetItem"].string))"
        case "choose-menu-option":return "Selecting \(readableGameText(a["targetOption"].string))"
        case "choose-bag-item":return "Selecting \(CartridgeItem.name(nativeID:a["targetItemId"].int,catalog:catalog["heldItems"].array) ?? "the required item")"
        case "choose-storage-box":return a["targetBox"].finiteNumber.map { "Opening PC Box \(Self.count($0+1))" } ?? "Choosing a PC box"
        case "choose-storage-option":return "Choosing a PC storage option"
        case "choose-storage-party-member":return "Selecting a party Pokémon at the PC"
        case "choose-storage-box-member":return "Selecting a boxed Pokémon"
        case "confirm-storage-action":return "Confirming the PC operation"
        case "choose-storage-menu-action":return "Choosing \(readableGameText(a["targetAction"].string)) for the boxed Pokémon"
        case "confirm-storage-release":return a["targetOption"].string == "yes" ? "Releasing the selected Egg-sticker hatchling" : "Keeping the Pokémon: its release was not verified"
        case "acknowledge-storage-message":return "Advancing the PC message"
        case "cancel-storage-action":return "Cancelling the PC operation"
        case "exit-storage", "exit-storage-mode":return "Leaving the PC"
        case "choose-storage-continue":return "Finishing the PC operation"
        case "choose-bag-pocket":return "Opening the required Bag pocket"
        case "choose-bag-context-action":return "Choosing \(readableGameText(a["targetAction"].string)) for the item"
        case "choose-tm-case-item":return "Selecting the required TM or HM"
        case "choose-mart-menu-item":return "Opening the Poké Mart menu"
        case "choose-mart-item":return "Selecting supplies to buy"
        case "choose-mart-quantity":return "Setting the purchase quantity"
        case "open-start-menu":return "Opening the game menu"
        case "close-menu":return "Closing the game menu"
        case "choose-move-to-forget":return "Selecting a move to replace"
        case "keep-pokemon-species-name":return "Keeping the Pokémon’s species name"
        case "enter-naming-screen-text":return "Entering the requested name"
        case "choose-new-game-option":return "Selecting the game’s startup option"
        case "choose-default-cartridge-option":return "Confirming the game prompt"
        case "retain-active-pokemon":return "Keeping the current Pokémon in battle"
        case "confirm-battle-target":return "Confirming the move’s target"
        case "choose-safari-command":return "Choosing the Safari action"
        case "choose-fly-destination":return "Choosing a Fly destination"
        case "use-fishing-rod":return "Fishing for an encounter"
        case "use-field-move":return "Using the required field move"
        case "push-field-obstacle":return "Moving the field obstacle"
        case "face-direction", "face-fishing-water":return "Facing the next interaction"
        case "traverse-map-connection", "traverse-door-warp", "traverse-directional-warp", "reenter-map-warp", "traverse-ledge":return target.map { "Entering \($0)" } ?? "Crossing to the next area"
        case "mission-complete":return "Verifying task completion"
        case "interact", "interact-with-object":return "Interacting with the route’s next objective"
        case "stop-for-review":return "Stopping to review the game state"
        case "":return nil
        default:return "Completing a game action"
        }
    }
    private static func reason(_ action: JSONValue, winner: JSONValue) -> String? {
        let constraints=Set(winner["constraints"].array.map(\.string)), objective=action["objective"].string
        if constraints.contains("release-egg-sticker-hatchling") { return "Releasing Egg-sticker hatchlings to free PC space." }
        if constraints.contains("increase-capture-probability") { return "Applying a status condition to improve the catch chance." }
        if constraints.contains("critical-hit-safe-capture-damage") { return "Weakening the target while keeping the predicted critical hit survivable." }
        if constraints.contains("high-confidence-knockout-margin") { return "The training Pokémon is healthy and its move is predicted to finish the opponent." }
        if objective.contains("training") && objective.contains("switch") { return "Giving the training Pokémon battle participation before switching." }
        if objective == "lead-with-training-member" { return "Putting the assigned training Pokémon first in the party." }
        if constraints.contains("trainer-battle-recovery") { return "Using owned medicine to keep the team in the trainer battle." }
        if !action["expectedUtility"].isNull { return "Ranked highest among available moves for the current matchup." }
        if action["kind"].string == "acknowledge-cartridge-prompt" { return "The game is waiting for confirmation before it can continue." }
        if objective.contains("control-bulky") { return "Using a control move against a bulky opponent." }
        return nil
    }
    private static func history(_ entries:[JSONValue],catalog:JSONValue,party:[JSONValue]) -> [ActivityDecision] {
        var result:[ActivityDecision]=[]
        for (index,e) in entries.enumerated().reversed() {
            let winner=e["winner"],d=e["decision"]
            let a=d["recommendation"].isNull ? winner["recommendation"] : d["recommendation"]
            guard d["kind"].string != "resample",let title=action(a,catalog:catalog,party:party) else { continue }
            let row=ActivityDecision(id:e["id"].string.nonempty ?? "entry-\(index)",title:title,reason:reason(a,winner:winner),location:place(e["map"]),date:date(e["updatedAt"].string),frame:number(e["lastFrame"]),repeats:max(1,e["repeats"].int),buttons:d["action"]["buttons"].array.map { $0.string.uppercased() }.joined(separator:" + ").nonempty,evidence:winner["evidenceRefs"].array.map(\.string),constraints:winner["constraints"].array.map(\.string))
            if let previous=result.last,previous.title==row.title,previous.reason==row.reason,previous.location==row.location,previous.evidence==row.evidence,previous.constraints==row.constraints { result[result.count-1].repeats += row.repeats }
            else { result.append(row) }
        }
        return Array(result.prefix(12))
    }
    private static func species(_ id:JSONValue,catalog:JSONValue) -> String {
        catalog["species"].array.first { $0["id"]==id }?["name"].string.nonempty ?? (id.isNull ? "the selected Pokémon" : "Pokémon \(id.text)")
    }
    private static func checkpoint(_ value:JSONValue) -> String? {
        let id=value["id"].string
        if id.hasPrefix("master-") {
            if id.hasSuffix("evolve-train") { return "Train for the planned evolution" }
            if id.hasSuffix("evolve-party") { return "Prepare the evolution party" }
            if id.hasSuffix("evolve") { return "Complete the planned evolution" }
        }
        return value["label"].string.nonempty
    }
    private static func place(_ v:JSONValue) -> String? {
        guard let raw=v.string.nonempty else { return nil }
        return readableGameText(raw).replacingOccurrences(of:"Route([0-9])",with:"Route $1",options:.regularExpression).replacingOccurrences(of:"Pokemon",with:"Pokémon").replacingOccurrences(of:"Pokémon Center 1F",with:"Pokémon Center",options:.caseInsensitive)
    }
    private static func date(_ raw:String) -> Date? {
        let parser=ISO8601DateFormatter();parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        if let date=parser.date(from:raw) { return date };parser.formatOptions=[.withInternetDateTime];return parser.date(from:raw)
    }
    private static func count(_ value:Double) -> String { value.formatted(.number.precision(.fractionLength(0))) }
    private static func number(_ v:JSONValue) -> String? { v.finiteNumber.flatMap { $0 >= 0 ? count($0) : nil } }
    private static func counter(_ label:String,_ v:JSONValue,into facts:inout [ActivityFact]) { if let value=number(v) { facts.append(.init(label:label,value:value)) } }
    private static func ratio(_ label:String,_ current:JSONValue,_ total:JSONValue,into facts:inout [ActivityFact]) { if let a=number(current),let b=number(total) { facts.append(.init(label:label,value:"\(a) / \(b)")) } }
    private static func durationFact(_ label:String,_ ms:Double?,into facts:inout [ActivityFact]) {
        guard let ms,ms.isFinite,ms>=0,ms < Double(Int.max/2) else { return }
        let seconds=Int(ms/1000)
        facts.append(.init(label:label,value:seconds>=3600 ? String(format:"%d:%02d:%02d",seconds/3600,seconds/60%60,seconds%60) : String(format:"%d:%02d",seconds/60,seconds%60)))
    }
}
