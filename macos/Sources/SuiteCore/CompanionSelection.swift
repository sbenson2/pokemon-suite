import Foundation

public enum CompanionSelection {
    public static func game(in state:JSONValue)->String? {
        let library=Set(state["library"].array.map{$0["id"].string})
        let selected=state["session"]["game"].string
        if library.contains(selected){return selected}
        return state["sessions"].array.first {
            library.contains($0["game"].string) && !$0["sessionId"].string.isEmpty && !["closed","offline"].contains($0["state"].string)
        }?["game"].string
    }
}
