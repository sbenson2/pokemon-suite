import SwiftUI
import SuiteCore

/// Fits the existing Team grid's bounds; only the bordered facts area scrolls.
struct PartyInlineDetails:View {
    let p:PartyMemberPresentation
    let member:JSONValue
    var compact=false
    let close:()->Void
    @EnvironmentObject var model:SuiteModel
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var inventory:JSONValue = .null
    @State private var individualID:String?
    @State private var reading=true
    @State private var refreshFailed=false
    private var palette:GamePalette {GamePalette(dark:scheme == .dark)}
    private var snapshot:PartyDetailSnapshot? {
        let party=model.session["spectator"]["party"].array
        guard let index=party.firstIndex(where:{member in
            let candidate=PartyMemberPresentation(member:member,index:0)
            return candidate.speciesID==p.speciesID && candidate.shiny==p.shiny
        }) else{return nil}
        return PartyDetailSnapshot(inventory:inventory,party:party,index:index,game:model.selectedGame,
                            sessionID:model.session["sessionId"].string,ownerID:PartyDetailSnapshot.ownerID(in:model.session),
                            expectedID:individualID,catalog:model.dex)
    }
    private var sex:String? {p.gender.map{$0=="♀" ? "Female":"Male"} ?? snapshot?.sex}
    private var requestID:String {[model.pairing?.certificateSHA256 ?? "",model.selectedGame,model.session["sessionId"].string,String(p.speciesID ?? 0),String(p.shiny),scenePhase == .active ? "active":"inactive"].joined(separator:"|")}
    private var health:Color {Color(hex:(p.hpRatio ?? 1) <= 0.2 ? 0xEF5A4A:(p.hpRatio ?? 1) <= 0.5 ? 0xCEAD4A:0x52CE52)}
    private var heldItem:String {
        if let item=p.heldItem {return CartridgeItem.name(nativeID:item,catalog:model.dex["heldItems"].array) ?? "Item \(item)"}
        return member["heldItem"] == .number(0) ? "None":"—"
    }
    var body:some View {
        VStack(alignment:.leading,spacing:compact ? 5:8) {
            Button(action:close) {
                HStack(spacing:compact ? 5:8) {
                    if let id=p.speciesID {ROMSprite(id:id,shiny:p.shiny,size:compact ? 48:56).accessibilityHidden(true)}
                    else {Image(systemName:"questionmark.square.dashed").frame(width:44,height:44).accessibilityHidden(true)}
                    VStack(alignment:.leading,spacing:2) {
                        Text(p.name).font(compact ? .system(size:15,weight:.semibold):.headline).lineLimit(compact ? 1:2)
                        HStack(spacing:4) {
                            Text("Lv. \(p.level.map(String.init) ?? "—")")
                            if let sex {Text(sex=="Female" ? "♀":sex=="Male" ? "♂":"Genderless").accessibilityLabel(sex)}
                            if p.shiny {Image(systemName:"sparkles")}
                        }.font(compact ? .system(size:13):.subheadline).foregroundStyle(palette.secondary)
                    }.frame(maxWidth:.infinity,alignment:.leading)
                    Image(systemName:"chevron.backward").font(compact ? .system(size:12,weight:.semibold):.body.weight(.semibold)).foregroundStyle(palette.focus)
                }.padding(.horizontal,compact ? 5:8).frame(maxWidth:.infinity,minHeight:44,alignment:.leading)
                    .background(palette.inset,in:RoundedRectangle(cornerRadius:5))
                    .overlay{RoundedRectangle(cornerRadius:5).strokeBorder(palette.focus.opacity(0.65),lineWidth:1)}
                    .contentShape(Rectangle())
            }.buttonStyle(.plain)
                .accessibilityIdentifier("party-detail-toggle")
                .accessibilityLabel("\(p.shiny ? "Shiny ":"")\(p.name), level \(p.level.map(String.init) ?? "unknown")\(sex.map{", \($0)"} ?? ""). Return to team")
                .accessibilityHint("Closes Pokémon details")
            ScrollView(.vertical) {
                VStack(alignment:.leading,spacing:compact ? 9:12) {
                    VStack(spacing:3) {
                        fact("HP","\(p.hp.map(String.init) ?? "—") / \(p.maxHP.map(String.init) ?? "—")")
                        GameMeter(value:p.hpRatio,color:health,label:"Health",reading:"\(p.hp.map(String.init) ?? "—") of \(p.maxHP.map(String.init) ?? "—")",height:5)
                    }
                    if let status=p.status {fact("Status",status)}
                    if p.name != p.speciesName {fact("Species",p.speciesName)}
                    fact("Held item",heldItem)
                    VStack(spacing:3) {
                        fact("Next level",p.experienceRemaining.map{"\($0.formatted()) XP"} ?? "—")
                        if let xp=p.experienceRatio {GameMeter(value:xp,color:palette.focus,label:"Experience",reading:p.experienceRemaining.map{"\($0) to next level"} ?? "Progress to next level",height:3)}
                    }
                    if let snapshot {
                        savedDetails(snapshot)
                    } else if reading && model.selectedGame=="firered" {
                        HStack(spacing:6){ProgressView().controlSize(.small);Text("Reading details…")}.font(detailFont).foregroundStyle(palette.secondary)
                    } else {
                        Text(model.selectedGame=="firered" ? "Waiting for this Pokémon’s save details.":"Additional details aren’t available for this game.")
                            .font(detailFont).foregroundStyle(palette.secondary).fixedSize(horizontal:false,vertical:true)
                    }
                    fact("Position",String(p.slot+1))
                }.padding(compact ? 7:10).frame(maxWidth:.infinity,alignment:.leading)
            }.scrollBounceBehavior(.basedOnSize)
                .background(palette.inset,in:RoundedRectangle(cornerRadius:5))
                .clipShape(RoundedRectangle(cornerRadius:5))
                .overlay{RoundedRectangle(cornerRadius:5).strokeBorder(palette.edge.opacity(0.65),lineWidth:1).allowsHitTesting(false)}
                .accessibilityIdentifier("party-detail-facts")
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading)
            .foregroundStyle(palette.text)
            .accessibilityElement(children:.contain)
            .accessibilityIdentifier("party-inline-details")
            .accessibilityAction(.escape,close)
            .task(id:requestID){await readDetails()}
    }
    private var detailFont:Font{compact ? .system(size:14):.body}
    @ViewBuilder private func savedDetails(_ details:PartyDetailSnapshot)->some View {
        Divider()
        HStack(spacing:4) {
            Text("Last save")
            Spacer(minLength:0)
            if let date=details.savedAt {Text(date,style:.time).monospacedDigit()}
        }.font(compact ? .system(size:13):.caption).foregroundStyle(palette.secondary)
        if refreshFailed {Text("Couldn’t refresh details").font(detailFont).foregroundStyle(palette.secondary)}
        fact("Ability",details.ability ?? "—").accessibilityIdentifier("party-fact-ability")
        fact("Sex",sex ?? "—").accessibilityIdentifier("party-fact-sex")
        fact("Nature",details.nature ?? "—")
        if !details.types.isEmpty {fact("Type",details.types.joined(separator:" / "))}
        Text("Moves").font(detailFont.weight(.semibold)).accessibilityAddTraits(.isHeader)
        ForEach(details.moves){move in
            VStack(alignment:.leading,spacing:4) {
                Text(move.name).font(detailFont.weight(.medium)).fixedSize(horizontal:false,vertical:true)
                HStack(alignment:.firstTextBaseline,spacing:4) {
                    if let type=move.type {Text(type)}
                    Spacer(minLength:0)
                    Text("\(move.pp.map(String.init) ?? "—")/\(move.maxPP.map(String.init) ?? "—") PP").monospacedDigit()
                }.font(detailFont).foregroundStyle(palette.secondary)
                if move.power != nil || move.accuracy != nil {
                    Text([move.power.map{"Power \($0)"},move.accuracy.map{"Accuracy \($0)%"}].compactMap{$0}.joined(separator:" · "))
                        .font(compact ? .system(size:13):.subheadline).foregroundStyle(palette.secondary).fixedSize(horizontal:false,vertical:true)
                }
            }.frame(maxWidth:.infinity,alignment:.leading).padding(.vertical,5)
                .accessibilityElement(children:.combine).accessibilityIdentifier("party-move-\(move.slot)")
            Divider()
        }
        if details.moves.isEmpty {Text("Moves unavailable").font(detailFont).foregroundStyle(palette.secondary)}
        Text("Stats\(details.savedLevel.map{" · Lv. \($0)"} ?? "")").font(detailFont.weight(.semibold)).accessibilityAddTraits(.isHeader)
        if typeSize.isAccessibilitySize {
            ForEach(details.stats){stat in
                VStack(alignment:.leading,spacing:4) {
                    fact(stat.name,stat.value.map(String.init) ?? "—")
                    Text("IV \(stat.iv.map(String.init) ?? "—") · EV \(stat.ev.map(String.init) ?? "—")").foregroundStyle(palette.secondary)
                }.font(detailFont).accessibilityElement(children:.combine)
            }
        } else {
        Grid(alignment:.leading,horizontalSpacing:compact ? 5:10,verticalSpacing:compact ? 7:10) {
            GridRow{Text("Stat");Text("Value");Text("IV");Text("EV")}.foregroundStyle(palette.secondary)
            ForEach(details.stats){stat in
                GridRow {
                    Text(stat.name)
                    Text(stat.value.map(String.init) ?? "—").monospacedDigit()
                    Text(stat.iv.map(String.init) ?? "—").monospacedDigit()
                    Text(stat.ev.map(String.init) ?? "—").monospacedDigit()
                }.accessibilityElement(children:.ignore)
                    .accessibilityLabel("\(stat.name), \(stat.value.map(String.init) ?? "unknown"), IV \(stat.iv.map(String.init) ?? "unknown"), EV \(stat.ev.map(String.init) ?? "unknown")")
            }
        }.font(detailFont)
        }
        if let friendship=details.friendship {fact("Friendship","\(friendship)/255")}
    }
    @MainActor private func readDetails() async {
        inventory = .null;individualID=nil;reading=true;refreshFailed=false
        guard scenePhase == .active,model.selectedGame=="firered",let api=model.api else{reading=false;return}
        let request=requestID,game=model.selectedGame
        while !Task.isCancelled,request==requestID {
            if model.connected {
                do {
                    let value=try await api.get("/api/pokemon-suite/inventory?game=\(game)&source=current")
                    guard !Task.isCancelled,request==requestID else{return}
                    inventory=value
                    if individualID==nil {individualID=snapshot?.id}
                    refreshFailed=false
                } catch {
                    guard !Task.isCancelled,request==requestID else{return}
                    refreshFailed=true
                }
            }
            reading=false
            do {try await Task.sleep(for:.seconds(15))} catch{return}
        }
    }
    private func fact(_ label:String,_ value:String)->some View {
        ViewThatFits(in:.horizontal) {
            HStack(alignment:.firstTextBaseline,spacing:6) {
                Text(label).foregroundStyle(palette.secondary).fixedSize()
                Spacer(minLength:0)
                Text(value).monospacedDigit().fixedSize()
            }
            VStack(alignment:.leading,spacing:2) {
                Text(label).foregroundStyle(palette.secondary)
                Text(value).monospacedDigit().fixedSize(horizontal:false,vertical:true)
            }
        }.font(detailFont)
            .accessibilityElement(children:.combine)
    }
}
