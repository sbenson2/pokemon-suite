import SwiftUI
import SuiteCore

struct LibraryView:View {
    @EnvironmentObject var model:SuiteModel
    @State private var search=""
    @State private var installedOnly=false
    @State private var details:JSONValue?
    let names=["gb":"Game Boy","gbc":"Game Boy Color","gba":"Game Boy Advance","nds":"Nintendo DS","3ds":"Nintendo 3DS","switch":"Nintendo Switch"]
    var filtered:[JSONValue]{model.games.filter{(!installedOnly || $0["status"].string != "missing") && (search.isEmpty || $0["title"].string.localizedCaseInsensitiveContains(search))}}
    var body:some View{
        VStack(spacing:0){
            GameSearchField("Find a game",text:$search).padding(.horizontal,8)
            HStack{Toggle("In my library",isOn:$installedOnly).toggleStyle(.button);Spacer();Text("\(filtered.count) games").font(.callout).foregroundStyle(.secondary)}.padding(.horizontal,16).padding(.vertical,8)
            BorderedScroll{
                LazyVStack(alignment:.leading,spacing:24){
                    ForEach(["gb","gbc","gba","nds","3ds","switch"],id:\.self){platform in
                        let games=filtered.filter{$0["platform"].string==platform}
                        if !games.isEmpty {
                            Text(names[platform] ?? platform).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                            LazyVGrid(columns:[GridItem(.adaptive(minimum:145,maximum:240),spacing:16)],spacing:20){
                                ForEach(games,id:\.gameID){game in
                                    VStack(spacing:6){
                                        Button{details=game}label:{VStack(spacing:4){CartridgeView(game:game).frame(height:146);Text(game["title"].string).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).multilineTextAlignment(.center).lineLimit(2).frame(minHeight:38)}}.buttonStyle(.plain)
                                        let running=model.state["sessions"].array.contains{$0["game"].string==game.gameID && !$0["sessionId"].string.isEmpty && !["closed","offline"].contains($0["state"].string)}
                                        if game["status"].string=="installed" {Button(running ? "View Game":"Start Game"){model.selectGame(game.gameID);if running{model.page = .live}else{model.startGame()}}.buttonStyle(.bordered).disabled(model.busy)}
                                        else {Button("Details"){details=game}.buttonStyle(.bordered)}
                                    }.padding(8).gameTile()
                                }
                            }
                        }
                    }
                }
            }.overlay{if filtered.isEmpty{ContentUnavailableView.search(text:search)}}
        }
        .sheet(isPresented:Binding(get:{details != nil},set:{if !$0{details=nil}})){
            if let game=details {NavigationStack{Form{Section{CartridgeView(game:game).frame(height:200);Text(game["title"].string).font(.title2.weight(.semibold));LabeledContent("Console",value:names[game["platform"].string] ?? "");LabeledContent("Status",value:game["status"].string.capitalized)};Section{if game["status"].string=="installed"{Button("Open Live Game"){model.selectGame(game.gameID);model.page = .live;details=nil}}else{Text("Add this game or configure its emulator on your Mac.").foregroundStyle(.secondary)}}}.navigationTitle("Game details").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){details=nil}}}}}
    }
}
}
