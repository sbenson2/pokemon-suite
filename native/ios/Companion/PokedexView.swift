import SwiftUI
import SuiteCore

/// The Bank: every species with the individuals owned in every save the Mac knows
/// (read-only), how FireRed obtains it, and "Get it", which asks the bot through the
/// same goals as Ask. Pokédex details stay alongside. Bank data covers FireRed.
struct PokedexView:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var scheme
    @State private var filter=PokedexFilter()
    @State private var selection:JSONValue?
    @State private var showingDetail=false
    /// GET /api/pokemon-suite/bank: every species' ownership and route.
    @State private var bank:JSONValue = .null
    @State private var issue:String?
    private var banked:Bool{model.selectedGame=="firered"}
    private var entries:[Int:JSONValue]{BankIndex.species(bank)}
    var filtered:[JSONValue]{filter.apply(to:model.species,bank:entries)}
    private var types:[String]{Set(model.species.flatMap{$0["types"].array.map(\.string)}).sorted()}
    var body:some View {
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 720 && !typeSize.isAccessibilitySize
            HStack(spacing:0) {
                speciesList.frame(maxWidth:wide ? 320:.infinity)
                if wide {
                    Divider()
                    if let mon=selection ?? model.species.first {PokemonDetail(mon:mon,entry:entries[mon["id"].int] ?? .null).id(mon["id"].int).frame(maxWidth:.infinity)}
                    else {ContentUnavailableView("Select a Pokémon",systemImage:"book.closed")}
                }
            }
            .sheet(isPresented:Binding(get:{!wide && showingDetail},set:{if !wide{showingDetail=$0}})) {
                if let mon=selection {NavigationStack{PokemonDetail(mon:mon,entry:entries[mon["id"].int] ?? .null).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){showingDetail=false}}}}}
            }
        }
        .onChange(of:model.selectedGame){_,_ in selection=nil;showingDetail=false;filter=PokedexFilter()}
        // Every save is read on the Mac (cached until a save changes).
        .task(id:model.selectedGame){bank = .null;issue=nil;guard banked else{return};while !Task.isCancelled{await loadBank();do{try await Task.sleep(for:.seconds(30))}catch{return}}}
    }
    private var speciesList:some View {
        VStack(spacing:4){
            HStack(spacing:4){
                GameSearchField("Search Pokémon",text:$filter.query)
                filterMenu
            }.padding(.horizontal,8)
            if model.species.isEmpty{ContentUnavailableView("Bank unavailable",systemImage:"book.closed",description:Text("Choose FireRed, LeafGreen, Emerald or Crystal."))}
            else{
                List(filtered,id:\.gameID){mon in Button{model.selectedSpecies=mon["id"].int;selection=mon;showingDetail=true}label:{row(mon)}.listRowBackground(GamePalette(dark:scheme == .dark).panel)}
                    .scrollContentBackground(.hidden).listStyle(.plain).overlay{Rectangle().stroke(Color(uiColor:.separator),lineWidth:0.5).allowsHitTesting(false)}
                    .overlay{if filtered.isEmpty{ContentUnavailableView.search(text:filter.query)}}
                if banked{footer}
            }
        }
    }
    private func row(_ mon:JSONValue)->some View {
        let entry=entries[mon["id"].int] ?? .null
        return HStack(spacing:14){
            ROMSprite(id:mon["id"].int,size:42)
            VStack(alignment:.leading,spacing:4){
                Text(mon["name"].string).font(.headline).foregroundStyle(.primary)
                Text(banked && !entry["route"]["label"].string.isEmpty ? entry["route"]["label"].string:mon["types"].array.map{$0.string.capitalized}.joined(separator:" / ")).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if entry["shiny"].int>0{Image(systemName:"sparkles").font(.caption).foregroundStyle(.orange).accessibilityLabel("Shiny owned")}
            if entry["owned"].int>0{Text("×\(entry["owned"].int)").font(.caption.weight(.semibold).monospacedDigit()).accessibilityLabel("\(entry["owned"].int) owned")}
            Text(String(format:"%03d",mon["id"].int)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            Image(systemName:"chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
    }
    private var filterMenu:some View {
        Menu {
            Picker("Type",selection:$filter.type){Text("All types").tag("any");ForEach(types,id:\.self){Text($0.capitalized).tag($0)}}
            if banked {
                Picker("Owned",selection:$filter.ownership){Text("Owned or not").tag("all");Text("Owned").tag("owned");Text("Shiny owned").tag("shiny");Text("Not owned").tag("missing")}
                Picker("Route",selection:$filter.availability){Text("Any route").tag("all");Text("Obtainable in FireRed").tag("obtainable");Text("Needs another game").tag("external")}
            }
        } label:{Image(systemName:filter.type=="any" && filter.ownership=="all" && filter.availability=="all" ? "line.3.horizontal.decrease.circle":"line.3.horizontal.decrease.circle.fill").font(.title3).frame(width:44,height:44)}
            .accessibilityLabel("Filter Pokémon").accessibilityIdentifier("bank-filter")
    }
    private var footer:some View {
        HStack{
            if bank.isNull && issue==nil{ProgressView().controlSize(.small);Text("Reading every save…")}
            else if let issue{Label(issue,systemImage:"exclamationmark.circle").lineLimit(2)}
            else{Text("\(bank["totals"]["owned"].int) of \(bank["totals"]["species"].int) species owned · \(bank["totals"]["shiny"].int) with a shiny")}
            Spacer();Text("\(filtered.count) shown")
        }.font(.caption).foregroundStyle(.secondary).padding(.horizontal,12).padding(.vertical,6)
    }
    private func loadBank() async {
        let game=model.selectedGame
        guard let api=model.api,model.connected else{return}
        do{let value=try await api.get("/api/pokemon-suite/bank?game=\(game)");guard !Task.isCancelled,game==model.selectedGame else{return};bank=value;issue=nil}
        catch{if game==model.selectedGame{issue=error.localizedDescription}}
    }
}

/// One species: its owned individuals, how FireRed gets it, Get It, and the Pokédex details.
struct PokemonDetail:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.dismiss) private var dismiss
    let mon:JSONValue
    /// The species' Bank overview entry (owned counts and route); null outside FireRed.
    var entry:JSONValue = .null
    @State private var section=""
    @State private var shiny=false
    @State private var owned:JSONValue = .null
    @State private var inspecting:JSONValue?
    @State private var gettingIt=false
    @State private var building:CompetitiveBuilderRequest?
    private var banked:Bool{model.selectedGame=="firered"}
    private var sections:[String]{banked ? ["Owned","Overview","Locations","Moves"]:["Overview","Locations","Moves"]}
    /// The chosen tab; the Bank opens on Owned.
    private var shown:String{sections.contains(section) ? section:sections[0]}
    private var activeTrade:Bool{!owned["trade"]["phase"].string.isEmpty && !["complete","cancelled"].contains(owned["trade"]["phase"].string)}
    var body:some View{
        VStack(spacing:0){
            HStack(spacing:20){
                ROMSprite(id:mon["id"].int,shiny:shiny,size:84)
                VStack(alignment:.leading,spacing:6){
                    Text(mon["name"].string).font(.title2.weight(.semibold))
                    Text(mon["types"].array.map{$0.string.capitalized}.joined(separator:" / ")).foregroundStyle(.secondary)
                    if banked && !entry.isNull {Text(BankIndex.ownership(entry) ?? "Not in any save").font(.callout).accessibilityIdentifier("bank-ownership")}
                    Toggle("Shiny",isOn:$shiny).toggleStyle(.button)
                };Spacer()
            }.padding(16)
            if banked && !entry.isNull {
                Text("\(entry["route"]["label"].string) · \(entry["route"]["detail"].string)").font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth:.infinity,alignment:.leading).padding(.horizontal,16).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("bank-route")
            }
            SectionTabs(label:"Bank details",items:sections,selection:Binding(get:{shown},set:{section=$0}))
            BorderedScroll{VStack(alignment:.leading,spacing:16){
                if shown=="Owned"{ownedList}
                else if shown=="Overview"{
                    Text("Base stats").font(.headline)
                    ForEach(["hp","attack","defense","specialAttack","specialDefense","speed"],id:\.self){stat in HStack{Text(statName(stat)).frame(width:80,alignment:.leading);ProgressView(value:Double(mon["stats"][stat].int),total:255).accessibilityLabel(statName(stat));Text(mon["stats"][stat].text).monospacedDigit().frame(width:30)}}
                    Divider();LabeledContent("Abilities",value:mon["abilities"].array.map(\.label).joined(separator:", "));LabeledContent("Catch rate",value:mon["catchRate"].text);LabeledContent("Egg groups",value:mon["eggGroups"].array.map(\.text).joined(separator:", "))
                }else if shown=="Locations"{
                    if mon["encounters"].array.isEmpty{Text(banked ? "No wild encounters. Get It shows the bot’s route.":"No wild encounters. Preview a hunt for other routes.").foregroundStyle(.secondary)}
                    ForEach(Array(mon["encounters"].array.enumerated()),id:\.offset){_,entry in VStack(alignment:.leading,spacing:6){Text(entry["location"].string).font(.headline);Text(entry["method"].string).font(.callout).foregroundStyle(.secondary);HStack{Text("Lv. \(entry["minLevel"].text)–\(entry["maxLevel"].text)");Spacer();Text("\(entry["chance"].text)%")}.font(.caption);Divider()}}
                }else{ForEach(Array(mon["learnset"].array.enumerated()),id:\.offset){_,entry in let move=model.dex["moves"].array.first{$0["id"].int==entry["moveId"].int} ?? .null;HStack{Text(move.label);Spacer();Text(entry["method"].string=="level-up" ? "Level \(entry["level"].text)":entry["method"].string).foregroundStyle(.secondary)};Divider()}}
            }}
            if banked {
                HStack(spacing:10){
                    Button("Get It"){gettingIt=true}.buttonStyle(.borderedProminent).disabled(entry.isNull).accessibilityIdentifier("bank-get-it")
                    Button("Competitive Build"){building=CompetitiveBuilderRequest(speciesID:mon["id"].int)}.accessibilityIdentifier("bank-competitive-build")
                }.padding(12)
            } else {
                Button("Set Up Hunt"){model.selectedSpecies=mon["id"].int;model.page = .farming;dismiss()}.buttonStyle(.borderedProminent).padding(12)
            }
        }.navigationTitle("Bank").navigationBarTitleDisplayMode(.inline)
        .task(id:"\(model.selectedGame):\(mon["id"].int)"){guard banked else{return};while !Task.isCancelled{await loadOwned();do{try await Task.sleep(for:.seconds(10))}catch{return}}}
        .sheet(item:Binding(get:{inspecting.map(BankInspection.init)},set:{inspecting=$0?.mon})){item in
            NavigationStack{
                OwnedPokemonDetail(mon:item.mon,inventory:.object(["sourceId":item.mon["sourceId"]]),activeTrade:activeTrade,actionTitle:"Send to Switch"){inspecting=nil;await loadOwned()}
                    .toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){inspecting=nil}}}
            }
        }
        .competitiveBuilder($building)
        .sheet(isPresented:$gettingIt){
            NavigationStack{
                BankGetItView(mon:mon,route:entry["route"],flow:model.bankRequests)
                    .navigationTitle("Get \(mon["name"].string)").navigationBarTitleDisplayMode(.inline)
                    .toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){gettingIt=false}}}
            }
        }
    }
    @ViewBuilder private var ownedList:some View {
        let pokemon=BankIndex.individuals(owned)
        if owned.isNull{ProgressView("Reading every save…").frame(maxWidth:.infinity)}
        else if pokemon.isEmpty{Text("No \(mon["name"].string) in any save the Mac knows. Get It asks the bot to catch one.").foregroundStyle(.secondary)}
        else{
            ForEach(pokemon,id:\.bankRowID){individual in
                Button{inspecting=individual}label:{
                    HStack(spacing:12){
                        ROMAsset(kind:"pokemon",key:individual["nationalSpeciesId"].text,shiny:individual["shiny"].bool,size:44,label:individual["name"].string)
                        VStack(alignment:.leading,spacing:3){
                            HStack(spacing:4){Text(individual["nickname"].string.nonempty ?? individual["name"].string).font(.headline);if individual["shiny"].bool{Image(systemName:"sparkles").foregroundStyle(.orange).accessibilityLabel("Shiny")};if individual["isEgg"].bool{Text("Egg").font(.caption).foregroundStyle(.secondary)}}
                            Text([individual["level"].int>0 ? "Lv. \(individual["level"].int)":nil,individual["natureName"].string.nonempty,"IVs "+BankIndex.ivs(individual)].compactMap{$0}.joined(separator:" · ")).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Text(BankIndex.whereHeld(individual)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength:0);Image(systemName:"chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityHint("Inspect")
                Divider()
            }
        }
    }
    private func loadOwned() async {
        let game=model.selectedGame,species=mon["id"].int
        guard let api=model.api,model.connected else{return}
        do{
            let value=try await api.get("/api/pokemon-suite/bank?game=\(game)&species=\(species)")
            guard !Task.isCancelled,game==model.selectedGame else{return}
            owned=value
            if let shown=inspecting,let fresh=BankIndex.individuals(value).first(where:{$0.bankRowID==shown.bankRowID}){inspecting=fresh}
        }catch{}
    }
}

private struct BankInspection:Identifiable {
    let mon:JSONValue
    var id:String{mon.bankRowID}
}
extension JSONValue {
    /// One individual in one save (the same Pokémon can be in several saves).
    var bankRowID:String{self["sourceId"].string+":"+self["slotId"].string}
}
