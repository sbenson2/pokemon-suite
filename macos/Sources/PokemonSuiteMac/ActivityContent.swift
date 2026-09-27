import SwiftUI
import SuiteCore

/// Shared by the Live Activity tab and the Bot settings overview.
struct ActivityPanel: View {
    @EnvironmentObject var model: SuiteModel
    var body: some View {
        TimelineView(.periodic(from:.now,by:2)) { context in
            ActivityContent(presentation:ActivityPresentation(session:model.session,catalog:model.dex,now:context.date),
                            onTriageFix:{ model.applyTriageFix($0) })
        }
    }
}

/// Lets a host without the suite model (such as a review renderer) draw species artwork.
struct ActivitySpriteProvider { let make: (Int, CGFloat) -> AnyView }
private struct ActivitySpriteKey: EnvironmentKey { static let defaultValue: ActivitySpriteProvider? = nil }
extension EnvironmentValues {
    var activitySprite: ActivitySpriteProvider? { get { self[ActivitySpriteKey.self] } set { self[ActivitySpriteKey.self] = newValue } }
}

struct ActivityContent: View {
    let presentation: ActivityPresentation
    @State private var expanded = false
    @State private var checklistExpanded = false
    @State private var detail = "Progress"
    @State private var selectedDecision: ActivityDecision?
    @State private var triageEvidence = false
    @Environment(\.activitySprite) private var spriteProvider
    /// Runs a proven-safe "Why it stopped" fix after the owner taps it (nil: explanation only).
    let onTriageFix: ((StopTriage.Suggestion) -> Void)?
    init(presentation: ActivityPresentation, checklistExpanded: Bool = false, onTriageFix: ((StopTriage.Suggestion) -> Void)? = nil) {
        self.presentation = presentation
        self.onTriageFix = onTriageFix
        _checklistExpanded = State(initialValue: checklistExpanded)
    }
    private var p: ActivityPresentation { presentation }
    private var o: ActivityOutline { presentation.outline }
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            ViewThatFits(in:.horizontal) {
                HStack {
                    status
                    Spacer(minLength:12)
                    Text(p.freshness).font(.caption).foregroundStyle(.secondary)
                }.fixedSize(horizontal:true,vertical:false)
                VStack(alignment:.leading,spacing:4) { status; Text(p.freshness).font(.caption).foregroundStyle(.secondary) }
            }
            ActivityColumns {
                VStack(alignment:.leading,spacing:12) {
                    if let triage=p.triage { triageCard(triage) }
                    if let request=o.request { requestCard(request) }
                    if let goal=o.goal { goalCard(goal) }
                    if let task=o.task { taskCard(task) }
                    if o.goal == nil && o.task == nil && o.request == nil { current }
                }
                VStack(alignment:.leading,spacing:16) {
                    if o.goal != nil || o.task != nil || o.request != nil { current }
                    upNext
                    if let agenda=o.agenda { checklist(agenda) }
                }
            }
            if !p.facts.isEmpty || !p.metrics.isEmpty || !p.diagnostics.isEmpty || !p.decisions.isEmpty {
                Divider()
                details
            }
        }.frame(maxWidth:.infinity,alignment:.leading).textSelection(.enabled)
            .sheet(item:$selectedDecision) { ActivityDecisionSheet(decision:$0) }
    }
    private var status: some View {
        Label(p.status,systemImage:p.symbol).font(.callout.weight(.medium))
            .foregroundStyle(p.needsAttention || p.stale ? Color.orange : Color.primary)
            .accessibilityIdentifier("activityStatus")
    }
    private func heading(_ text:String) -> some View {
        Text(text).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
    }

    private func goalCard(_ goal:ActivityGoal) -> some View {
        ActivityCard {
            heading(o.goalKind)
            Text(goal.title).font(.title3.weight(.semibold)).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityGoal")
            if let detail=goal.detail { Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
            if let meter=goal.meter { meterView(meter) }
            notes(goal.notes)
        }
    }

    /// Why the owner stopped (L1.1): the host's triage, its evidence, and a fix only when the host proved it safe.
    /// The button states what will happen; nothing runs until it is tapped, and the host re-checks it first.
    private func triageCard(_ t:StopTriage) -> some View {
        ActivityCard {
            HStack(alignment:.firstTextBaseline,spacing:8) {
                heading(p.status == "Recovering automatically" ? "Why it is recovering" : "Why it stopped")
                Spacer(minLength:8)
                Text(t.bucketLabel).font(.caption.weight(.semibold)).foregroundStyle(.secondary).accessibilityIdentifier("activityTriageBucket")
            }
            Text(t.title).font(.headline).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityTriageTitle")
            Text(t.explanation).font(.callout).fixedSize(horizontal:false,vertical:true)
            if !t.evidence.isEmpty {
                DisclosureGroup("Evidence",isExpanded:$triageEvidence) {
                    VStack(alignment:.leading,spacing:4) {
                        ForEach(Array(t.evidence.enumerated()),id:\.offset) { _,line in Text(line).font(.caption).fixedSize(horizontal:false,vertical:true) }
                    }.padding(.top,4)
                }.font(.callout)
            }
            if t.suggestion.canTap, let onTriageFix, let label=t.suggestion.label, let effect=t.suggestion.effect {
                Text(effect).font(.callout).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityTriageEffect")
                Button(label) { onTriageFix(t.suggestion) }.buttonStyle(.borderedProminent).accessibilityIdentifier("activityTriageFix")
            } else if !t.suggestion.why.isEmpty {
                Text(t.suggestion.why).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            }
        }.accessibilityElement(children:.contain).accessibilityIdentifier("activityTriage")
    }

    /// A request from "Ask the bot" the goal supervisor is working on.
    private func requestCard(_ request:ActivityGoal) -> some View {
        ActivityCard {
            heading("Your request")
            Text(request.title).font(.headline).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityRequest")
            notes(request.notes)
            if let detail=request.detail { Text(detail).font(.callout).fixedSize(horizontal:false,vertical:true) }
        }
    }

    private func taskCard(_ task:ActivityGoal) -> some View {
        ActivityCard {
            HStack(alignment:.top,spacing:8) {
                VStack(alignment:.leading,spacing:6) {
                    heading("Current task")
                    Text(task.title).font(.headline).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityTask")
                }
                Spacer(minLength:0)
                if !task.species.isEmpty {
                    HStack(spacing:2) {
                        ForEach(Array(task.species.enumerated()),id:\.offset) { index,id in
                            if index > 0 { Image(systemName:"arrow.right").font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                            sprite(id,size:40)
                        }
                    }.accessibilityHidden(true)
                }
            }
            if let detail=task.detail { Text(detail).font(.callout).fixedSize(horizontal:false,vertical:true) }
            if let meter=task.meter { meterView(meter) }
            notes(task.notes)
            if !o.plan.isEmpty {
                Divider().padding(.vertical,2)
                heading("Plan")
                VStack(alignment:.leading,spacing:8) { ForEach(o.plan) { step($0) } }.accessibilityIdentifier("activityPlan")
            }
        }
    }

    private func step(_ step:ActivityStep) -> some View {
        let symbol=step.state == .done ? "checkmark.circle.fill" : step.state == .current ? "circle.inset.filled" : "circle"
        let tint:Color=step.state == .done ? .green : step.state == .current ? .accentColor : .secondary
        let state=step.state == .done ? "Done" : step.state == .current ? "In progress" : "Not started"
        return HStack(alignment:.firstTextBaseline,spacing:8) {
            Image(systemName:symbol).foregroundStyle(tint).accessibilityHidden(true)
            VStack(alignment:.leading,spacing:2) {
                Text(step.title).font(step.state == .current ? .callout.weight(.semibold) : .callout)
                    .foregroundStyle(step.state == .upcoming ? .secondary : .primary).fixedSize(horizontal:false,vertical:true)
                if step.state == .current, let detail=step.detail ?? (["level","friendship"].contains(step.id) ? o.method : nil) {
                    Text(detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                }
            }
        }.accessibilityElement(children:.combine).accessibilityValue(state)
    }

    private var current: some View {
        VStack(alignment:.leading,spacing:6) {
            heading("Right now")
            Text(p.now).font(.headline).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityNow")
            if let why=p.why { Text(why).font(.callout).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityWhy") }
            if let latest=p.latestAction { Text("Latest action: \(latest)").font(.caption).foregroundStyle(.secondary) }
            if let location=p.location {
                Label(location,systemImage:"mappin.and.ellipse").font(.callout).padding(.top,2).accessibilityLabel("Location: \(location)")
            }
            if let route=o.route { routeView(route) }
            else if o.goal == nil, let goal=p.goal, p.next?.contains(goal) != true, p.why?.contains(goal) != true, p.now != goal { ActivityFactRow(label:"Goal",value:goal) }
            if o.route == nil, let destination=p.destination, destination != p.location, !p.now.contains(destination), p.next?.contains(destination) != true {
                Label("Heading to \(destination)",systemImage:"arrow.triangle.turn.up.right.diamond").font(.callout)
            }
        }
    }

    private func routeView(_ route:ActivityRoute) -> some View {
        VStack(alignment:.leading,spacing:4) {
            if !p.now.contains(route.destination) {
                Label("\(route.mode == "Flying" ? "Flying" : "Heading") to \(route.destination)",systemImage:route.mode == "Flying" ? "bird" : "arrow.triangle.turn.up.right.diamond").font(.callout)
            }
            let next=[route.next,route.steps.map { "\($0) steps on this map" },route.mode].compactMap { $0 }
            if !next.isEmpty { Text("Next: "+next.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
            if route.trail.count > 1 {
                Text("Recent route: "+route.trail.joined(separator:" → ")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            }
        }.accessibilityElement(children:.combine).accessibilityIdentifier("activityRoute")
    }

    @ViewBuilder private var upNext: some View {
        let later=o.agenda?.upNext ?? []
        let blocked=o.agenda?.notNow ?? []
        let taskNext=o.plan.isEmpty ? p.next : nil
        if taskNext != nil || !later.isEmpty || !blocked.isEmpty {
            VStack(alignment:.leading,spacing:6) {
                heading("Up next")
                if let next=taskNext { Text(next).font(.callout).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("activityNext") }
                if !later.isEmpty {
                    VStack(alignment:.leading,spacing:4) {
                        ForEach(later) { Label($0.label,systemImage:"circle").font(.callout) }
                    }.accessibilityIdentifier("activityUpNext")
                }
                if !blocked.isEmpty {
                    Text("Not running now").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top,4)
                    ForEach(blocked) { item in
                        VStack(alignment:.leading,spacing:2) {
                            Label(item.label,systemImage:item.state == .waiting ? "clock" : "minus.circle").font(.callout)
                            if let note=item.note { Text(note).font(.caption).foregroundStyle(.secondary).padding(.leading,22).fixedSize(horizontal:false,vertical:true) }
                        }
                    }
                }
            }
        }
    }

    private func checklist(_ agenda:ActivityAgenda) -> some View {
        DisclosureGroup(isExpanded:$checklistExpanded) {
            VStack(alignment:.leading,spacing:6) {
                ForEach(agenda.items) { item in
                    let symbol=["done":"checkmark.circle.fill","active":"circle.inset.filled","waiting":"clock","unavailable":"minus.circle"][String(describing:item.state)] ?? "circle"
                    HStack(alignment:.firstTextBaseline,spacing:8) {
                        Image(systemName:symbol).foregroundStyle(item.state == .done ? .green : item.state == .active ? .accentColor : .secondary).accessibilityHidden(true)
                        Text(item.label).font(item.state == .active ? .callout.weight(.semibold) : .callout)
                            .foregroundStyle(item.state == .done || item.state == .active ? .primary : .secondary).fixedSize(horizontal:false,vertical:true)
                    }.accessibilityElement(children:.combine).accessibilityValue(item.state == .done ? "Done" : item.state == .active ? "Active" : "Not done")
                }
            }.padding(.top,8)
        } label: {
            HStack {
                Text("Postgame checklist")
                Spacer(minLength:8)
                Text("\(agenda.completed) of \(agenda.total) done").foregroundStyle(.secondary).monospacedDigit()
            }
        }.accessibilityIdentifier("activityChecklist")
    }

    private var details: some View {
        DisclosureGroup("Details",isExpanded:$expanded) {
            VStack(alignment:.leading,spacing:14) {
                Picker("Activity details",selection:$detail) {
                    Text("Progress").tag("Progress");Text("Decisions").tag("Decisions");Text("Diagnostics").tag("Diagnostics")
                }.pickerStyle(.segmented).labelsHidden().accessibilityLabel("Activity details")
                if detail == "Progress" {
                    if !p.facts.isEmpty { facts(p.facts) }
                    if !p.metrics.isEmpty {
                        if !p.facts.isEmpty { Divider() }
                        Text("Game statistics").font(.headline)
                        facts(p.metrics)
                        Text("Game counters come from this save. Active bot time excludes pauses.").font(.caption).foregroundStyle(.secondary)
                    }
                    if p.facts.isEmpty && p.metrics.isEmpty { Text("No progress measurements published yet.").foregroundStyle(.secondary) }
                } else if detail == "Decisions" {
                    if p.decisions.isEmpty { Text("No recent actions published yet.").foregroundStyle(.secondary) }
                    else {
                        Text("Recent actions").font(.headline)
                        ForEach(p.decisions) { event in
                            Button { selectedDecision=event } label: {
                                HStack(alignment:.top,spacing:12) {
                                    VStack(alignment:.leading,spacing:4) {
                                        Text(event.title).foregroundStyle(.primary)
                                        if let reason=event.reason { Text(reason).font(.caption).foregroundStyle(.secondary) }
                                        HStack {
                                            if let date=event.date { Text(date,style:.time) }
                                            if event.repeats > 1 { Text("\(event.repeats) actions") }
                                        }.font(.caption).foregroundStyle(.secondary)
                                    }.frame(maxWidth:.infinity,alignment:.leading)
                                    Image(systemName:"chevron.right").font(.caption).foregroundStyle(.secondary).accessibilityHidden(true)
                                }.contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityHint("Show decision evidence")
                            if event.id != p.decisions.last?.id { Divider() }
                        }
                        Text("Repeated actions are grouped. Brief waits for the game are omitted.").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    facts(p.diagnostics)
                    Text("An emulator checkpoint is separate from an in-game save. Decision evidence is available under Decisions.").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(.top,12)
        }.accessibilityIdentifier("activityDetails")
    }

    private func meterView(_ meter:ActivityMeter) -> some View {
        VStack(alignment:.leading,spacing:4) {
            // Drawn in SwiftUI so offscreen layout renders match the window.
            GeometryReader { geometry in
                ZStack(alignment:.leading) {
                    Capsule().fill(.quaternary)
                    Capsule().fill(Color.accentColor).frame(width:max(6,geometry.size.width * meter.value / max(meter.total,1)))
                }
            }.frame(height:6).accessibilityElement().accessibilityLabel(meter.label)
                .accessibilityValue(Text("\(Int((meter.value / max(meter.total,1) * 100).rounded())) percent"))
            Text(meter.label).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
    @ViewBuilder private func notes(_ values:[String]) -> some View {
        if !values.isEmpty { Text(values.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
    }
    @ViewBuilder private func sprite(_ id:Int,size:CGFloat) -> some View {
        if let spriteProvider { spriteProvider.make(id,size) } else { ROMSprite(id:id,size:size) }
    }
    private func facts(_ values:[ActivityFact]) -> some View {
        VStack(alignment:.leading,spacing:10) { ForEach(values) { ActivityFactRow(label:$0.label,value:$0.value) } }
    }
}

private struct ActivityCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment:.leading,spacing:8) { content }
            .padding(12).frame(maxWidth:.infinity,alignment:.leading)
            .background(.fill.quaternary,in:RoundedRectangle(cornerRadius:10,style:.continuous))
    }
}

/// One column in the narrow Live panel; goal and task beside the current
/// activity when the Bot settings page is wide enough.
private struct ActivityColumns: Layout {
    var threshold: CGFloat = 640
    var spacing: CGFloat = 16
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? threshold
        if width >= threshold && subviews.count == 2 {
            let column = (width - spacing) / 2
            return CGSize(width:width,height:subviews.map { $0.sizeThatFits(.init(width:column,height:nil)).height }.max() ?? 0)
        }
        let heights = subviews.map { $0.sizeThatFits(.init(width:width,height:nil)).height }.filter { $0 > 0 }
        return CGSize(width:width,height:heights.reduce(0,+) + spacing * CGFloat(max(0,heights.count - 1)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        if bounds.width >= threshold && subviews.count == 2 {
            let column = (bounds.width - spacing) / 2
            for (index,view) in subviews.enumerated() {
                view.place(at:CGPoint(x:bounds.minX + CGFloat(index) * (column + spacing),y:bounds.minY),proposal:.init(width:column,height:nil))
            }
        } else {
            var y = bounds.minY
            for view in subviews {
                let height = view.sizeThatFits(.init(width:bounds.width,height:nil)).height
                view.place(at:CGPoint(x:bounds.minX,y:y),proposal:.init(width:bounds.width,height:height))
                if height > 0 { y += height + spacing }
            }
        }
    }
}

private struct ActivityFactRow: View {
    let label:String
    let value:String
    var body: some View {
        ViewThatFits(in:.horizontal) {
            HStack(alignment:.firstTextBaseline,spacing:16) { Text(label).foregroundStyle(.secondary); Spacer(minLength:0); Text(value) }
                .fixedSize(horizontal:true,vertical:false)
            VStack(alignment:.leading,spacing:3) { Text(label).foregroundStyle(.secondary); Text(value).fixedSize(horizontal:false,vertical:true) }
        }.font(.callout).frame(maxWidth:.infinity,alignment:.leading).accessibilityElement(children:.combine)
    }
}

private struct ActivityDecisionSheet: View {
    let decision:ActivityDecision
    @Environment(\.dismiss) var dismiss
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            HStack { Text("Decision details").font(.headline); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction) }
            BorderedScroll {
                VStack(alignment:.leading,spacing:14) {
                    Text(decision.title).font(.title3.weight(.semibold))
                    if let reason=decision.reason { Text(reason) }
                    if let location=decision.location { ActivityFactRow(label:"Location",value:location) }
                    if let date=decision.date { ActivityFactRow(label:"Time",value:date.formatted(date:.omitted,time:.standard)) }
                    if let frame=decision.frame { ActivityFactRow(label:"Emulated frame",value:frame) }
                    if let buttons=decision.buttons { ActivityFactRow(label:"Controller input",value:buttons) }
                    if !decision.constraints.isEmpty {
                        Text("Policy checks").font(.headline)
                        ForEach(Array(decision.constraints.enumerated()),id:\.offset) { _,line in Text(readableGameText(line)).font(.callout) }
                    }
                    if !decision.evidence.isEmpty {
                        Text("Recorded evidence").font(.headline)
                        ForEach(Array(decision.evidence.enumerated()),id:\.offset) { _,line in Text(line).font(.caption.monospaced()).fixedSize(horizontal:false,vertical:true) }
                    }
                }.textSelection(.enabled)
            }
        }.padding(20)
        #if os(iOS)
        .frame(maxWidth:.infinity,maxHeight:.infinity)
        #else
        .frame(minWidth:420,idealWidth:480,minHeight:360,idealHeight:460)
        #endif
    }
}
