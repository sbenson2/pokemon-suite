import SwiftUI
import SuiteCore

struct TradingView:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var inventory:JSONValue = .null
    @State private var filter=PCInventoryFilter()
    @State private var selected:JSONValue?
    @State private var showingDetail=false
    @State private var connection=false
    @State private var loading=true
    @State private var issue:String?
    @AppStorage("companion-pc-appearance") private var appearance="all"
    var pokemon:[JSONValue]{inventory["pokemon"].array}
    var visible:[JSONValue]{pokemon.filter(filter.includes)}
    var activeTrade:Bool{!inventory["trade"]["phase"].string.isEmpty && !["complete","cancelled"].contains(inventory["trade"]["phase"].string)}
    var body:some View {
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 720 && !typeSize.isAccessibilitySize
            HStack(spacing:0) {
                collection.frame(maxWidth:.infinity)
                if wide {
                    Divider()
                    Group {
                        if let mon=selected {OwnedPokemonDetail(mon:mon,inventory:inventory,activeTrade:activeTrade){selected=nil;showingDetail=false;await reload()}}
                        else {ContentUnavailableView("Select a Pokémon",systemImage:"cursorarrow.click")}
                    }.frame(width:340)
                }
            }
            .sheet(isPresented:Binding(get:{!wide && showingDetail && selected != nil},set:{if !wide{showingDetail=$0}})) {
                if let mon=selected {NavigationStack{OwnedPokemonDetail(mon:mon,inventory:inventory,activeTrade:activeTrade){selected=nil;showingDetail=false;await reload()}.toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){showingDetail=false}}}}}
            }
        }
    }
    private var collection:some View {
        VStack(spacing:0){
            GameSearchField("Search Pokémon",text:$filter.query).padding(.horizontal,8)
            HStack{
                Picker("Save",selection:Binding(get:{inventory["sourceId"].string.nonempty ?? "current"},set:chooseSource)){
                    if inventory["sources"].array.isEmpty{Text("Current game").tag("current")}
                    ForEach(inventory["sources"].array,id:\.gameID){Text($0["label"].string).tag($0.gameID)}
                }.pickerStyle(.menu).labelsHidden().disabled(model.busy)
                Spacer();Button{connection=true}label:{Image(systemName:"antenna.radiowaves.left.and.right")}.accessibilityLabel("Wireless connection")
            }.padding(.horizontal,12).frame(minHeight:44)
            SectionTabs(label:"Appearance",items:["All","Shiny","Not shiny"],selection:Binding(get: {filter.appearance=="shiny" ? "Shiny":filter.appearance=="normal" ? "Not shiny":"All"},set:{filter.appearance=$0=="Shiny" ? "shiny":$0=="Not shiny" ? "normal":"all";appearance=filter.appearance}))
            HStack{
                Picker("Location",selection:$filter.location){Text("All locations").tag("all");Text("Party").tag("party");ForEach(0..<14,id:\.self){Text("Box \($0+1)").tag(String($0))}}.pickerStyle(.menu)
                Spacer();Text("\(visible.count) Pokémon").font(.caption).foregroundStyle(.secondary)
            }.padding(.horizontal,12).padding(.bottom,8)
            if loading && inventory.isNull {ProgressView("Reading Pokémon…").frame(maxWidth:.infinity,maxHeight:.infinity)}
            else if inventory["validity"].string != "valid" {ContentUnavailableView("Inventory unavailable",systemImage:"externaldrive.badge.questionmark",description:Text(issue ?? inventory["reason"].string))}
            else {
                BorderedScroll{
                    LazyVGrid(columns:[GridItem(.adaptive(minimum:88,maximum:125),spacing:8)],spacing:8){
                        ForEach(visible,id:\.gameID){mon in Button{selected=mon;showingDetail=true}label:{VStack(spacing:4){ZStack(alignment:.topTrailing){ROMAsset(kind:"pokemon",key:mon["nationalSpeciesId"].text,shiny:mon["shiny"].bool,size:52,label:mon["name"].string);if mon["shiny"].bool{Image(systemName:"sparkles").font(.caption).foregroundStyle(.orange)}};Text(mon["name"].string).font(.caption).lineLimit(1).minimumScaleFactor(0.8);if mon["level"].int>0{Text("Lv. \(mon["level"].text)").font(.caption2).foregroundStyle(.secondary)}}.frame(maxWidth:.infinity).padding(.vertical,10).gameTile()}.buttonStyle(.plain).accessibilityLabel("\(mon["shiny"].bool ? "Shiny ":"")\(mon["name"].string), level \(mon["level"].text)")}
                    }.overlay{if visible.isEmpty{ContentUnavailableView("No matches",systemImage:"line.3.horizontal.decrease")}}
                }
                HStack{Text("\(pokemon.count) owned");Spacer();Label("\(pokemon.filter{$0["shiny"].bool}.count) shiny",systemImage:"sparkles")}.font(.caption).foregroundStyle(.secondary).padding(12)
            }
            if activeTrade {
                HStack{VStack(alignment:.leading,spacing:4){Text("Trade in progress").font(.headline);Text(inventory["trade"]["phase"].string.replacingOccurrences(of:"-",with:" ").capitalized).font(.caption).foregroundStyle(.secondary)};Spacer();Button("Stop Trade"){model.command("/api/pokemon-suite/stop-trade")}.disabled(model.busy)}.padding(12).background(.bar)
            }
        }
        .task(id:model.selectedGame){inventory = .null;selected=nil;showingDetail=false;filter.location="all";filter.appearance=appearance;loading=true;while !Task.isCancelled{await reload();do{try await Task.sleep(for:.seconds(5))}catch{return}}}
        .sheet(isPresented:$connection){NavigationStack{Form{Section("Mac radio"){LabeledContent("Status",value:inventory["radio"]["ready"].bool ? "Ready":"Unavailable");if !inventory["radio"]["reason"].string.isEmpty{Text(inventory["radio"]["reason"].string).foregroundStyle(.secondary)};Button("Check Radio"){model.command("/api/pokemon-suite/check-radio")}};Section{Text("The Mac runs the complete trade. Keep it awake until both games finish saving.").font(.callout)}}.navigationTitle("Wireless connection").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){connection=false}}}}}
    }
    func reload() async{let game=model.selectedGame;guard let api=model.api,model.connected else{return};do{let value=try await api.get("/api/pokemon-suite/inventory?game=\(game)");guard !Task.isCancelled,game==model.selectedGame else{return};inventory=value;loading=false;issue=nil}catch{if game==model.selectedGame{issue=error.localizedDescription;loading=false}}}
    func chooseSource(_ id:String){model.command("/api/pokemon-suite/inventory-source",fields:["sourceId":.string(id)]);selected=nil;Task{try? await Task.sleep(for:.seconds(1));await reload()}}
}

struct OwnedPokemonDetail:View {
    @EnvironmentObject var model:SuiteModel
    let mon:JSONValue;let inventory:JSONValue;let activeTrade:Bool;let finished:() async->Void
    /// "Prepare Trade" in Trading; the Bank calls the same trade "Send to Switch".
    let actionTitle:String
    @State private var section="Overview"
    @State private var confirm=false
    init(mon:JSONValue,inventory:JSONValue,activeTrade:Bool,actionTitle:String="Prepare Trade",finished:@escaping () async->Void){self.mon=mon;self.inventory=inventory;self.activeTrade=activeTrade;self.actionTitle=actionTitle;self.finished=finished}
    var body:some View{
        VStack(spacing:0){
            HStack(spacing:18){ROMAsset(kind:"pokemon",key:mon["nationalSpeciesId"].text,shiny:mon["shiny"].bool,size:92,label:mon["name"].string);VStack(alignment:.leading,spacing:6){Text(mon["name"].string).font(.title2.weight(.semibold));if mon["level"].int>0{Text("Level \(mon["level"].text)").foregroundStyle(.secondary)};if mon["shiny"].bool{Label("Shiny",systemImage:"sparkles").foregroundStyle(.orange).font(.callout)}};Spacer()}.padding(16)
            SectionTabs(label:"Pokémon details",items:["Overview","Stats","Moves"],selection:$section)
            BorderedScroll{VStack(alignment:.leading,spacing:16){
                if section=="Overview"{if let save=mon["saveLabel"].string.nonempty{LabeledContent("Save",value:save)};if !mon["alsoIn"].array.isEmpty{LabeledContent("Also in",value:mon["alsoIn"].array.map(\.string).joined(separator:"\n"))};LabeledContent("Nature",value:mon["nature"]["name"].string.nonempty ?? mon["nature"].text);LabeledContent("Ability",value:mon["ability"]["name"].string.nonempty ?? mon["ability"].text);LabeledContent("Trainer ID",value:String(format:"%05d",mon["trainerId"].int));LabeledContent("Held item",value:mon["heldItem"].int==0 ? "None":CartridgeItem.name(nativeID:mon["heldItem"].int,catalog:model.dex["heldItems"].array) ?? "Item \(mon["heldItem"].int)");LabeledContent("Location",value:mon["location"]["kind"].string=="party" ? "Party":"Box \(mon["location"]["box"].int+1)")}
                else if section=="Stats"{ForEach(["hp","attack","defense","specialAttack","specialDefense","speed"],id:\.self){stat in HStack{Text(statName(stat));Spacer();Text("IV \(mon["ivs"][stat=="specialAttack" ? "spAttack":stat=="specialDefense" ? "spDefense":stat].text)");Text("EV \(mon["evs"][stat=="specialAttack" ? "spAttack":stat=="specialDefense" ? "spDefense":stat].text)").foregroundStyle(.secondary)}}}
                else{ForEach(Array(mon["moveDetails"].array.enumerated()),id:\.offset){_,move in LabeledContent(move["name"].string.nonempty ?? move.label,value:move["pp"].isNull ? "":"\(move["pp"].text) PP")}}
            }}
            VStack(spacing:10){if !mon["canTrade"].bool{Text(mon["tradeReason"].string.nonempty ?? "This Pokémon cannot be traded right now.").font(.callout).foregroundStyle(.secondary)};Button(actionTitle){confirm=true}.buttonStyle(.borderedProminent).disabled(!mon["canPrepare"].bool || activeTrade || model.busy || !model.connected);if activeTrade{Text("Finish or stop the current trade first.").font(.caption).foregroundStyle(.secondary)}}.padding(16)
        }.navigationTitle("Pokémon").navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Trade \(mon["name"].string)?",isPresented:$confirm,titleVisibility:.visible){Button("Prepare Trade"){let game=model.selectedGame;model.perform{let plan=(try await model.api?.post("/api/pokemon-suite/trade-plan",.object(["game":.string(game),"pokemonId":mon["id"],"sourceId":inventory["sourceId"]])) ?? .null)["plan"];try await model.prepareOwnedTrade(plan);await finished()}}}message:{Text("Your Mac will retrieve this Pokémon, heal and save, then open its trade lobby.")}
    }
}
