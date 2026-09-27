import SwiftUI
import SceneKit

struct SpinningPokeball:View {
    let isOpen:Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    var body:some View {
        PokeballScene(isOpen:isOpen,animated:!reduceMotion && phase == .active)
    }
}

private struct PokeballScene:UIViewRepresentable {
    let isOpen:Bool
    let animated:Bool
    final class Coordinator { var open:Bool?;var animated:Bool? }
    func makeCoordinator()->Coordinator { Coordinator() }
    private func material(_ color:UIColor,metal:CGFloat=0.15)->SCNMaterial {
        let m=SCNMaterial();m.diffuse.contents=color;m.lightingModel = .physicallyBased
        m.roughness.contents=0.3;m.metalness.contents=metal
        return m
    }
    // Inner surfaces have reversed normals and winding: these are hollow shells.
    private func hemisphere(radius:Float,upper:Bool,inward:Bool=false,start:Float=0,end:Float=2 * .pi)->SCNGeometry {
        let rows=20,columns=48
        var vertices=[SCNVector3](),normals=[SCNVector3](),indices=[Int32]()
        for row in 0...rows {
            let latitude=Float(row)/Float(rows) * .pi/2
            for column in 0...columns {
                let longitude=start+(end-start)*Float(column)/Float(columns)
                let n=SCNVector3(sin(latitude)*sin(longitude),cos(latitude)*(upper ? 1 : -1),sin(latitude)*cos(longitude))
                vertices.append(SCNVector3(n.x*radius,n.y*radius,n.z*radius))
                let sign:Float=inward ? -1:1
                normals.append(SCNVector3(n.x*sign,n.y*sign,n.z*sign))
            }
        }
        for row in 0..<rows { for column in 0..<columns {
            let a=Int32(row*(columns+1)+column),b=a+Int32(columns+1)
            let triangle:[Int32]=[a,b,a+1,a+1,b,b+1]
            indices.append(contentsOf:upper != inward ? triangle:Array(triangle.reversed()))
        }}
        return SCNGeometry(sources:[SCNGeometrySource(vertices:vertices),SCNGeometrySource(normals:normals)],elements:[SCNGeometryElement(indices:indices,primitiveType:.triangles)])
    }
    func makeUIView(context:Context)->SCNView {
        let view=SCNView()
        view.backgroundColor = .clear;view.isOpaque=false;view.isUserInteractionEnabled=false
        view.antialiasingMode = .multisampling4X;view.preferredFramesPerSecond=30
        let scene=SCNScene(),ball=SCNNode(),hinge=SCNNode(),lid=SCNNode()
        ball.name="ball";hinge.name="hinge"
        scene.rootNode.addChildNode(ball)
        hinge.position.z = -0.94;lid.position.z=0.94
        ball.addChildNode(hinge);hinge.addChildNode(lid)
        let charcoal=UIColor(white:0.075,alpha:1)
        for upper in [false,true] {
            let shell=upper ? lid:ball
            let outer=hemisphere(radius:1,upper:upper)
            outer.materials=[material(upper ? UIColor(red:0.82,green:0.045,blue:0.07,alpha:1):UIColor(white:0.95,alpha:1))]
            shell.addChildNode(SCNNode(geometry:outer))
            let lining=hemisphere(radius:0.91,upper:upper,inward:true)
            lining.materials=[material(charcoal)];shell.addChildNode(SCNNode(geometry:lining))
            let rim=SCNTorus(ringRadius:0.955,pipeRadius:0.046)
            rim.materials=[material(charcoal)];shell.addChildNode(SCNNode(geometry:rim))
            for index in 0..<6 {
                let start=Float(index) * .pi/3+0.045
                let panel=hemisphere(radius:0.899,upper:upper,inward:true,start:start,end:start + .pi/3-0.09)
                panel.materials=[material(UIColor(white:upper ? 0.48:0.36,alpha:1),metal:0.7)]
                shell.addChildNode(SCNNode(geometry:panel))
            }
            let socket=SCNCylinder(radius:0.21,height:0.05)
            socket.materials=[material(charcoal)]
            let socketNode=SCNNode(geometry:socket);socketNode.position.y=upper ? 0.87 : -0.87
            shell.addChildNode(socketNode)
            let emitter=SCNCylinder(radius:0.115,height:0.055)
            emitter.materials=[material(UIColor(red:0.27,green:0.64,blue:0.52,alpha:1),metal:0.5)]
            let emitterNode=SCNNode(geometry:emitter);emitterNode.position.y=upper ? 0.84 : -0.84
            shell.addChildNode(emitterNode)
        }
        for (radius,depth,z,color) in [(0.24,0.065,1.0,charcoal),(0.17,0.075,1.04,UIColor.white),(0.115,0.025,1.09,UIColor(white:0.88,alpha:1))] {
            let geometry=SCNCylinder(radius:radius,height:depth);geometry.radialSegmentCount=40;geometry.materials=[material(color)]
            let node=SCNNode(geometry:geometry);node.eulerAngles.x = .pi/2;node.position.z=Float(z);lid.addChildNode(node)
        }
        let camera=SCNNode();camera.camera=SCNCamera();camera.camera?.usesOrthographicProjection=true
        camera.camera?.orthographicScale=1.3;camera.position=SCNVector3(0,0,5);scene.rootNode.addChildNode(camera)
        let ambient=SCNNode();ambient.light=SCNLight();ambient.light?.type = .ambient;ambient.light?.intensity=450;scene.rootNode.addChildNode(ambient)
        let key=SCNNode();key.light=SCNLight();key.light?.type = .omni;key.light?.intensity=1000;key.position=SCNVector3(-3,4,5);scene.rootNode.addChildNode(key)
        view.scene=scene;view.pointOfView=camera
        return view
    }
    func updateUIView(_ view:SCNView,context:Context) {
        guard context.coordinator.open != isOpen || context.coordinator.animated != animated,
              let ball=view.scene?.rootNode.childNode(withName:"ball",recursively:true),
              let hinge=ball.childNode(withName:"hinge",recursively:true) else {return}
        let first=context.coordinator.open == nil
        context.coordinator.open=isOpen;context.coordinator.animated=animated
        let orientation=ball.presentation.eulerAngles
        ball.removeAllActions();ball.eulerAngles=orientation
        let duration=animated && !first ? 0.35:0
        SCNTransaction.begin();SCNTransaction.animationDuration=duration
        hinge.eulerAngles.x=isOpen ? -1.95:0
        ball.eulerAngles=SCNVector3(isOpen ? 0.24:0,0,-0.12)
        ball.position.y=isOpen ? -0.3:0
        view.pointOfView?.camera?.orthographicScale=isOpen ? 1.75:1.3
        SCNTransaction.commit()
        if animated && !isOpen {
            ball.runAction(.sequence([.wait(duration:duration),.repeatForever(.rotateBy(x:0,y:2 * .pi,z:0,duration:9))]),forKey:"spin")
        }
        view.isPlaying=animated;view.rendersContinuously=animated;view.setNeedsDisplay()
    }
    static func dismantleUIView(_ view:SCNView,coordinator:Coordinator) {
        view.isPlaying=false;view.rendersContinuously=false;view.scene=nil
    }
}
