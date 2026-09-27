import Combine
import Foundation

/// How a request reached the interpreter (Goal v1 `source.via`).
public enum BotRequestVia: String, Sendable {
    case typed, voice, ui
    /// Dictated text stays a voice request until the owner edits it by typing.
    public static func resolve(text: String, dictated: String?) -> BotRequestVia {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let dictated, !text.isEmpty, text == dictated.trimmingCharacters(in: .whitespacesAndNewlines) else { return .typed }
        return .voice
    }
}

public struct BotRequestChoice: Equatable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public init(id: String, label: String) { self.id = id; self.label = label }
    init?(_ value: JSONValue) {
        let raw = value["id"]
        let id = raw.string.nonempty ?? (raw.finiteNumber != nil ? raw.text : "")
        guard !id.isEmpty else { return nil }
        self.init(id: id, label: value["label"].string.nonempty ?? id)
    }
}

/// The interpreter's one pending question (answered by re-interpreting the same text).
public struct BotRequestClarification: Equatable, Sendable {
    public let id: String
    public let question: String
    public let choices: [BotRequestChoice]
    public let freeText: Bool
}

/// One `POST /api/pokemon-suite/requests/interpret` response.
public struct BotRequestDraft: Equatable, Sendable {
    public let draftId: String
    public let understood: Bool
    public let confidence: Double
    public let summary: String
    public let message: String
    public let clarification: BotRequestClarification?
    public let confirmationRequired: Bool
    public let confirmationReasons: [String]
    /// The Goal v1 draft the commit hands to the goal supervisor (null for answers).
    public let goal: JSONValue
    /// Settings changes or a goal cancellation applied by the commit itself.
    public let direct: [JSONValue]
    public let answer: String?
    public let suggestions: [String]
    public let unsupported: String?
    public let limitations: [String]
    public let warnings: [String]

    public init(response r: JSONValue) throws {
        guard let draftId = r["draftId"].string.nonempty else { throw SuiteError("The Suite returned an incomplete request. Try again.") }
        self.draftId = draftId
        understood = r["understood"].bool
        confidence = r["confidence"].double
        summary = r["summary"].string
        message = r["message"].string
        let c = r["clarification"]
        if let id = c["id"].string.nonempty {
            clarification = BotRequestClarification(id: id, question: c["question"].string.nonempty ?? r["message"].string,
                                                    choices: c["choices"].array.compactMap(BotRequestChoice.init), freeText: c["freeText"].bool)
        } else { clarification = nil }
        confirmationRequired = r["confirmation"]["required"].bool
        confirmationReasons = r["confirmation"]["reasons"].array.compactMap { $0.string.nonempty }
        goal = r["goal"]
        direct = r["direct"].array
        answer = r["answer"].string.nonempty
        suggestions = r["suggestions"].array.compactMap { $0.string.nonempty }
        unsupported = r["unsupported"].string.nonempty
        // As the web shows it: the first limitation of each hunt preview.
        limitations = r["preview"].array.compactMap { $0["limitations"].array.first?.string.nonempty }
        warnings = r["warnings"].array.compactMap { $0.string.nonempty }
    }

    /// Something the commit can run: a goal or a direct action.
    public var runnable: Bool { understood && clarification == nil && (!goal.isNull || !direct.isEmpty) }
    /// Confirmation reasons (when a confirmation is required), preview limits and warnings.
    public var notes: [String] { (confirmationRequired ? confirmationReasons : []) + limitations + warnings }
}

public struct BotRequestCommit: Equatable, Sendable {
    public let goal: SuiteGoal?
    public let applied: [String]
    public let line: String
}

public enum BotRequestStage: Equatable, Sendable {
    case idle
    case interpreting
    case clarifying(BotRequestDraft)
    case notUnderstood(BotRequestDraft)
    case answered(BotRequestDraft)
    case ready(BotRequestDraft)
    case committing(BotRequestDraft)
    case committed(BotRequestCommit)
    case failed(String)
}

/// The Suite endpoints the request flow uses: the Mac's local session or the
/// companion's authenticated relay (its bearer-token SuiteAPI).
public struct BotRequestTransport {
    public var get: @MainActor (String) async throws -> JSONValue
    public var post: @MainActor (String, JSONValue) async throws -> JSONValue
    public init(get: @escaping @MainActor (String) async throws -> JSONValue, post: @escaping @MainActor (String, JSONValue) async throws -> JSONValue) {
        self.get = get; self.post = post
    }
}

/// "Ask the bot": text or dictation -> interpret -> clarification answers or
/// confirmation -> commit with a per-draft idempotency key -> the goal
/// supervisor. It only talks to the request and goal endpoints; the host
/// validates and runs everything, and nothing here sends game input.
@MainActor public final class BotRequestFlow: ObservableObject {
    public static let maxLength = 1000
    static let interpretPath = "/api/pokemon-suite/requests/interpret"
    static let commitPath = "/api/pokemon-suite/requests/commit"
    static let draftCancelPath = "/api/pokemon-suite/requests/cancel"
    static let warmPath = "/api/pokemon-suite/requests/warm"
    /// Seconds a warm-up covers: Laya only exits after 10 idle minutes, so one this recent is running or still loading.
    public static let warmInterval: TimeInterval = 30
    static let goalsPath = "/api/pokemon-suite/goals"
    static let cancelPath = "/api/pokemon-suite/goals/cancel"

    @Published public private(set) var stage: BotRequestStage = .idle
    /// A failed commit; the draft stays so the same key can be retried.
    @Published public private(set) var error: String?
    /// The goal list (GET /goals), read after a commit or cancel and on request.
    @Published public private(set) var goals: SuiteGoals?
    @Published public private(set) var goalNotice: String?
    @Published public private(set) var cancelling: String?
    public private(set) var text = ""
    public private(set) var via: BotRequestVia = .typed
    public private(set) var answers: [String: String] = [:]
    public private(set) var idempotencyKey: String?
    private let transport: BotRequestTransport
    private let makeKey: () -> String
    private let now: () -> Date
    private var generation = 0
    private var warmedAt: Date?

    public init(client: String, transport: BotRequestTransport, makeKey: (() -> String)? = nil, now: @escaping () -> Date = Date.init) {
        self.transport = transport
        self.makeKey = makeKey ?? { "\(client)-\(UUID().uuidString.lowercased())" }
        self.now = now
    }

    public var isWorking: Bool {
        switch stage { case .interpreting, .committing: return true; default: return false }
    }
    public var draft: BotRequestDraft? {
        switch stage {
        case .clarifying(let d), .notUnderstood(let d), .answered(let d), .ready(let d), .committing(let d): return d
        default: return nil
        }
    }
    /// The button for a runnable draft: destructive steps need an explicit confirmation.
    public var confirmLabel: String? {
        guard case .ready(let d) = stage else { return nil }
        return d.confirmationRequired ? "Confirm" : "Run"
    }
    /// One status line, as the web "Ask the bot" result line.
    public var resultLine: String {
        switch stage {
        case .idle: return ""
        case .interpreting: return "Reading your request…"
        case .clarifying(let d): return d.clarification?.question ?? d.message
        case .notUnderstood(let d): return d.message.nonempty ?? "I didn’t understand that."
        case .answered(let d): return d.answer ?? d.summary
        case .ready(let d): return d.summary
        case .committing: return "Sending…"
        case .committed(let c): return c.line
        case .failed(let message): return message
        }
    }

    public func submit(_ raw: String, via: BotRequestVia) async {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !isWorking else { return }
        guard value.count <= Self.maxLength else { reset(); stage = .failed("Keep your request under 1,000 characters."); return }
        if value != text { answers = [:] }
        text = value; self.via = via
        await interpret()
    }

    /// A clarification chip.
    public func choose(_ choice: BotRequestChoice) async { await answer(choice.id) }

    /// A typed answer to the pending clarification (when it accepts free text).
    public func answer(_ value: String) async {
        guard !isWorking, case .clarifying(let d) = stage, let id = d.clarification?.id else { return }
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        answers[id] = value
        await interpret()
    }

    /// A suggested phrase offered after an unsupported request.
    public func useSuggestion(_ suggestion: String) async {
        guard !isWorking else { return }
        text = suggestion; via = .ui; answers = [:]
        await interpret()
    }

    public func commit() async {
        guard case .ready(let d) = stage, let key = idempotencyKey else { return }
        let ticket = generation
        stage = .committing(d); error = nil
        let body: JSONValue = .object(["draftId": .string(d.draftId), "idempotencyKey": .string(key),
                                       "answers": .object(d.confirmationRequired ? ["confirm": .string("yes")] : [:])])
        do {
            let out = try await transport.post(Self.commitPath, body)
            guard ticket == generation else { return }
            let goal = SuiteGoal(goal: out["goal"])
            let applied = out["applied"].array.map { $0["kind"].string }
            let line = goal.map { "Goal \($0.status.nonempty ?? "queued"): \(d.summary)" } ?? "Done: \(d.summary)"
            stage = .committed(BotRequestCommit(goal: goal, applied: applied, line: line))
            await refreshGoals()
        } catch {
            guard ticket == generation else { return }
            stage = .ready(d); self.error = error.localizedDescription
        }
    }

    /// Cancel on a proposed request: starts over at once, then tells the Suite, which drops the
    /// draft and logs the owner's "no" as the request's outcome (best effort).
    public func cancel() async {
        let id = draft?.draftId
        reset()
        guard let id else { return }
        _ = try? await transport.post(Self.draftCancelPath, .object(["draftId": .string(id)]))
    }

    /// Ask opened or the mic tapped: the Suite starts loading Laya without waiting, so the
    /// request that follows (after an idle pause or a host restart) can use it. Best effort:
    /// the draft is untouched, a failure is silent and lets the next tap try again.
    @discardableResult public func warm() -> Task<Void, Never>? {
        let time = now()
        if let warmedAt, time.timeIntervalSince(warmedAt) < Self.warmInterval { return nil }
        warmedAt = time
        return Task { [weak self, transport] in
            do { _ = try await transport.post(Self.warmPath, .object([:])) } catch { if self?.warmedAt == time { self?.warmedAt = nil } }
        }
    }

    /// Starts over; a response that arrives later is ignored.
    public func reset() {
        generation += 1
        stage = .idle; error = nil; answers = [:]; idempotencyKey = nil; text = ""
    }

    public func refreshGoals() async {
        do { goals = SuiteGoals(list: try await transport.get(Self.goalsPath)) } catch {}
    }

    /// Cancels a queued, running or waiting goal; the supervisor withdraws only what it started.
    @discardableResult public func cancelGoal(_ id: String) async -> Bool {
        guard cancelling == nil else { return false }
        cancelling = id; goalNotice = nil
        defer { cancelling = nil }
        do {
            let out = try await transport.post(Self.cancelPath, .object(["id": .string(id)]))
            let text = SuiteGoal(goal: out["goal"])?.text.nonempty
            goalNotice = text.map { "Cancelled “\($0)”." } ?? "Request cancelled."
            await refreshGoals()
            return true
        } catch {
            goalNotice = error.localizedDescription
            return false
        }
    }

    private func interpret() async {
        generation += 1
        let ticket = generation
        stage = .interpreting; error = nil
        let body: JSONValue = .object(["text": .string(text), "via": .string(via.rawValue), "answers": .object(answers.mapValues(JSONValue.string))])
        do {
            let response = try await transport.post(Self.interpretPath, body)
            guard ticket == generation else { return }
            let d = try BotRequestDraft(response: response)
            idempotencyKey = makeKey()
            if d.clarification != nil { stage = .clarifying(d) }
            else if !d.understood { stage = .notUnderstood(d) }
            else if d.runnable { stage = .ready(d) }
            else { stage = .answered(d) }
        } catch {
            guard ticket == generation else { return }
            idempotencyKey = nil
            stage = .failed(error.localizedDescription)
        }
    }
}
