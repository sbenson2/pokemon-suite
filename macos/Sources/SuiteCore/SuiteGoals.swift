import Foundation

/// One owner goal (schema pokemon-suite/goal/v1) as the goal supervisor
/// reports it: the brief in `session.goals`, or a stored goal from
/// `GET /api/pokemon-suite/goals` and the goal endpoints.
public struct SuiteGoal: Equatable, Identifiable, Sendable {
    public let id: String
    public let status: String
    /// The owner's original phrase.
    public let text: String
    /// 0-based index into the executed plan.
    public let step: Int?
    public let steps: Int?
    public let kind: String?
    public let phase: String?
    public let detail: String?
    /// A question the goal waits on (for example the save choice).
    public let question: String?
    public let choices: [BotRequestChoice]
    public let result: String?
    public let updatedAt: String?

    /// `session.goals` entries (pokemon_goals.brief).
    public init?(brief b: JSONValue) {
        self.init(id: b["id"], status: b["status"], text: b["text"], progress: b, question: b["question"], result: b["result"], updatedAt: b["updatedAt"])
    }

    /// A stored goal (GET /goals, POST /goals, /goals/cancel, /requests/commit).
    public init?(goal g: JSONValue) {
        self.init(id: g["id"], status: g["status"], text: g["source"]["text"], progress: g["progress"], question: g["question"], result: g["result"], updatedAt: g["updatedAt"])
    }

    private init?(id: JSONValue, status: JSONValue, text: JSONValue, progress p: JSONValue, question: JSONValue, result: JSONValue, updatedAt: JSONValue) {
        guard let id = id.string.nonempty, let status = status.string.nonempty else { return nil }
        self.id = id; self.status = status; self.text = text.string
        step = p["step"].finiteNumber.map { Int($0) }
        steps = p["steps"].finiteNumber.map { Int($0) }
        kind = p["kind"].string.nonempty; phase = p["phase"].string.nonempty; detail = p["detail"].string.nonempty
        self.question = question["text"].string.nonempty
        choices = question["choices"].array.compactMap(BotRequestChoice.init)
        self.result = result["summary"].string.nonempty
        self.updatedAt = updatedAt.string.nonempty
    }

    /// Queued, running or waiting: the owner can still cancel it.
    public var isOpen: Bool { ["queued", "running", "waiting"].contains(status) }

    public var statusLabel: String {
        ["draft": "Draft", "queued": "Queued", "running": "Running", "waiting": "Waiting", "done": "Done", "failed": "Failed", "cancelled": "Cancelled"][status] ?? readableGameText(status)
    }

    public var stepLabel: String? {
        guard let steps, steps > 0 else { return nil }
        return "Step \(min(max((step ?? 0) + 1, 1), steps)) of \(steps)"
    }

    public var kindLabel: String? {
        guard let kind else { return nil }
        return ["farming": "Catch", "postgame": "Postgame target", "player-task": "Task", "collection": "Shiny collection",
                "trade": "Trade", "campaign": "New game", "status": "Question"][kind] ?? readableGameText(kind)
    }

    /// Supervisor phases (G2 NOTES 2.4) in the owner's words.
    public var phaseLabel: String? {
        guard let phase else { return nil }
        let labels = ["queued": "Queued", "starting": "Starting", "checking-save": "Checking the save", "needs-decision": "Needs your decision",
                      "needs-result": "Waiting for a recorded result", "campaign": "Playing the story", "hall-of-fame": "Entering the Hall of Fame",
                      "after-campaign": "Waiting for the story to finish", "postgame-priority": "Postgame priority target", "hunting": "Hunting",
                      "saving": "Saving", "caught": "Caught", "task": "Running a task", "collection": "Shiny collection", "trade": "Trading",
                      "traded": "Traded", "answered": "Answered", "paused": "Paused: stopped by you", "yielded": "Another task has control",
                      "other-save": "Another save is loaded", "game-offline": "Game offline", "attention": "Needs your attention",
                      "retrying": "Retrying", "done": "Done", "failed": "Failed", "cancelled": "Cancelled"]
        return labels[phase] ?? readableGameText(phase)
    }

    /// "Running · Step 2 of 3 · Hunting" (a one-step goal omits the step).
    public var progressLine: String {
        var parts = [statusLabel]
        if let steps, steps > 1, let stepLabel { parts.append(stepLabel) }
        if let phaseLabel, phaseLabel != statusLabel { parts.append(phaseLabel) }
        return parts.joined(separator: " · ")
    }
}

/// Goal status for the Ask panel and the Activity outline.
public struct SuiteGoals: Equatable, Sendable {
    /// The goal the supervisor works on (the oldest open goal not waiting on the owner).
    public var active: SuiteGoal?
    /// Queued goals behind the active one.
    public var queued: Int
    /// Goals parked until the owner decides (e.g. a new save).
    public var decisions: [SuiteGoal]
    public var last: SuiteGoal?
    public var supervisorWarning: String?

    /// `session.goals` (GoalStore.summary); nil when the session has no goal store.
    public init?(summary s: JSONValue) {
        guard case .object = s else { return nil }
        active = SuiteGoal(brief: s["active"])
        queued = max(0, s["queued"].int)
        decisions = s["decisions"].array.compactMap(SuiteGoal.init(brief:))
        last = SuiteGoal(brief: s["last"])
    }

    /// `GET /api/pokemon-suite/goals`, summarised as the host summarises the session.
    public init(list r: JSONValue) {
        let all = r["goals"].array
        let activeID = r["active"].string
        active = all.first { $0["id"].string == activeID && !activeID.isEmpty }.flatMap(SuiteGoal.init(goal:))
        queued = all.filter { $0["status"].string == "queued" && $0["id"].string != activeID }.count
        decisions = all.filter { $0["status"].string == "waiting" && $0["progress"]["phase"].string == "needs-decision" }.compactMap(SuiteGoal.init(goal:))
        let finished = all.filter { ["done", "failed", "cancelled"].contains($0["status"].string) }
        last = finished.max { ($0["finishedAt"].string.nonempty ?? $0["updatedAt"].string) < ($1["finishedAt"].string.nonempty ?? $1["updatedAt"].string) }.flatMap(SuiteGoal.init(goal:))
        if r["supervisor"]["running"] == .bool(false) {
            supervisorWarning = r["supervisor"]["error"].string.nonempty.map { "The goal supervisor stopped: \($0)" }
                ?? "The goal supervisor isn’t running, so requests won’t progress. Restart Pokémon Suite."
        }
    }

    /// The goal to show: the active one, else the first waiting for a decision.
    public var current: SuiteGoal? { active ?? decisions.first }
}
