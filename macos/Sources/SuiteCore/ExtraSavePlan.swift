import Foundation

/// Other FireRed saves that help the main save: the extra-save plan published by the host
/// (`GET /api/pokemon-suite/extra-saves` → `rows` and `partners`; the FireRed session carries
/// the same rows as `extraSaves`). Each row says which save supplies a one-per-save family, what
/// it is doing, and at most one owner action. The row-to-action mapping lives only here, so a
/// change to the host's routes is a single edit.
public struct ExtraSavePlan: Equatable, Sendable {
    public struct Action: Equatable, Sendable {
        public let title: String
        public let path: String
        public let body: JSONValue
        /// What starting it does, shown before the owner confirms.
        public let effect: String
    }
    public struct Row: Equatable, Sendable, Identifiable {
        public let id: String
        public let label: String
        public let species: [Int]
        public let route: String
        public let save: String
        public let mode: String
        public let status: String
        public let doing: String
        public let runtime: String
        public let action: Action?
        public var statusLabel: String { ExtraSavePlan.statusLabel(status) }
    }
    public struct Partner: Equatable, Sendable, Identifiable {
        public let owner: String
        public let lending: String?
        public let grants: Int
        public var id: String { owner }
    }

    public let rows: [Row]
    public let partners: [Partner]

    /// Accepts the route's response (`{rows, partners}`) or the session's bare `extraSaves` array.
    public init(_ value: JSONValue) {
        let rows = value.array.isEmpty ? value["rows"].array : value.array
        self.rows = rows.compactMap(ExtraSavePlan.row)
        partners = value["partners"].array.compactMap { p in
            p["owner"].string.nonempty.map { Partner(owner: $0, lending: p["lending"].string.nonempty ?? (p["lending"].isNull ? nil : p["lending"]["label"].string.nonempty), grants: p["grants"].int) }
        }
    }

    static func row(_ r: JSONValue) -> Row? {
        guard let id = r["needId"].string.nonempty else { return nil }
        return Row(id: id, label: r["label"].string.nonempty ?? id, species: r["species"].array.map(\.int).filter { $0 > 0 },
                   route: r["route"].string, save: r["save"].string, mode: r["mode"].string, status: r["status"].string,
                   doing: r["doing"].string, runtime: r["runtime"].string, action: action(for: r))
    }

    static let base = "/api/pokemon-suite/extra-saves/"

    /// The one action a row offers, or nil while the bot needs nothing from the owner.
    /// 1. A host-provided descriptor (`action: {title, path, body, effect}`) under the extra-saves routes wins.
    /// 2. Build 126 rows name it in `start`: `{action: "start-helper", saveId | needId}` or
    ///    `{action: "seed-partner", profileId}` (seed-partner parks an unparked archive first).
    /// 3. Build 125 rows have no `start`: a new helper save waiting to start (`helper.saveId`), or an
    ///    archived save waiting to become a partner when the row names its profile.
    public static func action(for r: JSONValue) -> Action? {
        let given = r["action"]
        if let path = given["path"].string.nonempty, path.hasPrefix(base), case .object = given["body"], let title = given["title"].string.nonempty {
            return Action(title: title, path: path, body: given["body"], effect: given["effect"].string.nonempty ?? r["doing"].string)
        }
        let label = r["label"].string.nonempty ?? "this family"
        let save = r["source"]["label"].string.nonempty ?? r["save"].string.nonempty ?? "This save"
        let s = r["start"]
        switch s["action"].string {
        case "start-helper":
            if let saveId = s["saveId"].string.nonempty { return newHelper(saveId: saveId, label: label) }
            if let needId = s["needId"].string.nonempty { return helperTask(needId: needId, kind: r["task"]["kind"].string, label: label, save: save) }
            return nil
        case "seed-partner":
            guard let profile = s["profileId"].string.nonempty else { return nil }
            return partner(profileId: profile, save: save, park: r["status"].string == "needs-park")
        case "":
            break
        default:
            return nil
        }
        switch r["status"].string {
        case "needs-helper-save":
            return r["helper"]["saveId"].string.nonempty.map { newHelper(saveId: $0, label: label) }
        case "needs-partner-owner":
            return (r["profileId"].string.nonempty ?? r["source"]["profileId"].string.nonempty).map { partner(profileId: $0, save: save, park: false) }
        default:
            return nil
        }
    }

    private static func newHelper(saveId: String, label: String) -> Action {
        Action(title: "Start Helper Save", path: base + "start-helper", body: .object(["saveId": .string(saveId)]),
               effect: "Starts a new FireRed save that the bot plays only until it can give the main save the \(label). It runs beside your main game and can take hours. Your main save isn’t changed.")
    }
    private static func helperTask(needId: String, kind: String, label: String, save: String) -> Action {
        let what = kind == "dojo-prize" ? "takes its Fighting Dojo prize" : kind == "roamer-capture" ? "plays its postgame until the roaming legendary appears, then catches it" : "does its task"
        return Action(title: kind == "dojo-prize" ? "Take the Dojo Prize" : kind == "roamer-capture" ? "Catch the Roaming Legendary" : "Start Helper Task",
                      path: base + "start-helper", body: .object(["needId": .string(needId)]),
                      effect: "\(save) \(what) in a working copy, then trades it to the main save for the \(label). The archived save itself is never written\(kind == "roamer-capture" ? ", and this can take many hours" : "").")
    }
    private static func partner(profileId: String, save: String, park: Bool) -> Action {
        Action(title: park ? "Prepare Trade Partner" : "Use as Trade Partner", path: base + "seed-partner", body: .object(["profileId": .string(profileId)]),
               effect: (park ? "\(save) first walks to a Pokémon Center and saves there. Then it " : "\(save) ") + "lends Pokémon to the main save through a working copy. The archived save itself is never written.")
    }

    /// The row status in plain words.
    public static func statusLabel(_ status: String) -> String {
        [
            "ready": "Ready", "in-progress": "In progress", "running": "In progress", "complete": "Done",
            "needs-partner-owner": "Needs setup", "needs-park": "Moving to a Pokémon Center",
            "needs-helper-save": "Ready to start", "needs-helper-task": "Not built yet",
            "planned-long": "Planned (long)", "planned": "Planned",
        ][status] ?? status.replacingOccurrences(of: "-", with: " ").capitalized
    }
}

/// How far a game session's save has come, for first-run guidance.
public enum SessionProgress {
    /// A save the bot has never played: a brand-new profile with no party, Pokédex or badges.
    /// For such a save the useful next step is New run, not "choose a task".
    public static func isBrandNewSave(_ session: JSONValue) -> Bool {
        guard !session["sessionId"].string.isEmpty, session["campaign"].isNull else { return false }
        if session["newProfile"].bool { return true }
        let spectator = session["spectator"]
        let badges = spectator["badges"].array.contains { $0["earned"].bool }
        return spectator["party"].array.isEmpty && session["observation"]["party"].array.isEmpty
            && spectator["trainer"]["pokedex"]["owned"].int == 0 && !badges && !spectator["trainer"].isNull
    }
}
