import SuiteCore

/// Spectator telemetry has no individual Pokémon ID. Follow a unique published
/// identity through battle reordering; close when that match becomes ambiguous.
struct PartyInspection {
    struct Roster:Equatable {
        let game:String
        let session:String
        let members:[[JSONValue]]
        init(party:[JSONValue],game:String,session:String) {
            self.game=game;self.session=session
            members=party.prefix(6).map { member in
                ["speciesId","nationalSpecies","speciesName","name","nickname","shiny","gender"].map { member[$0] }
            }
        }
    }
    private var selected:Int?
    private var source:Roster?

    func index(in roster:Roster)->Int? {
        guard let selected,let source,source.game==roster.game,source.session==roster.session else{return nil}
        if source==roster {return selected}
        let member=source.members[selected]
        guard source.members.filter({$0==member}).count==1 else{return nil}
        let matches=roster.members.indices.filter{roster.members[$0]==member}
        return matches.count==1 ? matches.first:nil
    }
    mutating func toggle(_ index:Int,in roster:Roster) {
        guard roster.members.indices.contains(index) else {close();return}
        if self.index(in:roster)==index {close()}
        else {selected=index;source=roster}
    }
    mutating func reconcile(with roster:Roster) {
        if let index=index(in:roster) {selected=index;source=roster}
        else {close()}
    }
    mutating func close() {selected=nil;source=nil}
}
