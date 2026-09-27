import SwiftUI
import SuiteCore

/// The reference's two-row composition. Expanded layouts retain full-size rows.
struct ReferenceDashboard:View {
    let width:CGFloat
    var availableHeight:CGFloat = 0
    var body:some View {
        let rowContentHeight=max(207,availableHeight-194)
        VStack(spacing:8){
            HStack(alignment:.top,spacing:6){
                TrainerPanel(compact:true).frame(width:(width-6)*0.56)
                LiveLocationPanel(compact:true).frame(width:(width-6)*0.44)
            }
            HStack(alignment:.top,spacing:6){
                PartyPanel(compact:true,contentHeight:rowContentHeight).frame(width:(width-6)*0.60)
                LiveSessionPanel(compact:true,contentHeight:rowContentHeight).frame(width:(width-6)*0.40)
            }
        }.frame(width:width,alignment:.top)
    }
}
