import Foundation

/// L1.1 "Why it stopped": the host's read-only stop triage (`session["triage"]`, schema
/// pokemon-suite/stop-triage/v1). It explains the stop and may carry a suggested fix. A fix is
/// offered as a button only when the host proved it safe; it runs only when the owner taps it,
/// and the host re-checks its token against fresh state before running it.
public struct StopTriage: Equatable {
    public struct Suggestion: Equatable {
        public let action: String
        public let safe: Bool
        public let why: String
        public let label: String?
        /// What the fix will do, shown next to the button before any tap.
        public let effect: String?
        /// The existing player-tasks action the tap posts.
        public let playerTask: String?
        public let token: String?
        /// Only the supported one-tap actions, with the host's proof, label, effect and token.
        public var canTap: Bool {
            safe && ["postgame", "resume"].contains(playerTask ?? "") && !(token ?? "").isEmpty && label != nil && effect != nil
        }
    }

    public let bucket: String
    public let family: String
    public let title: String
    public let explanation: String
    public let evidence: [String]
    public let fixedIn: Int?
    public let suggestion: Suggestion

    public var bucketLabel: String {
        ["transient-retry": "Temporary", "known-bug-family": "Known bug", "needs-code-fix": "Needs a code fix", "needs-owner": "Needs you"][bucket] ?? bucket
    }

    public init?(session: JSONValue) {
        let t = session["triage"], a = t["suggestedAction"]
        guard t["schema"].string == "pokemon-suite/stop-triage/v1", let title = t["title"].string.nonempty,
              let explanation = t["explanation"].string.nonempty, let action = a["action"].string.nonempty else { return nil }
        bucket = t["bucket"].string
        family = t["family"].string
        self.title = title
        self.explanation = explanation
        evidence = t["evidence"].array.compactMap { $0.string.nonempty }
        fixedIn = t["fixedIn"].isNull ? nil : t["fixedIn"].int
        suggestion = Suggestion(action: action, safe: a["safe"].bool, why: a["why"].string,
                                label: a["label"].string.nonempty, effect: a["confirm"].string.nonempty,
                                playerTask: a["playerTask"].string.nonempty, token: a["token"].string.nonempty)
    }
}
