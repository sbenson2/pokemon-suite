"""Prepare licensed cartridge geometry in Blender; never export source label textures.

Run with Blender --background --python this_file -- --downloads DIR --output DIR.
Original downloads stay outside the release. Attribution is in licenses/cartridge-models.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector


PALETTE = {
    'shell': (.22, .24, .27, 1), 'trim': (.10, .12, .14, 1),
    'clear_shell': (.11, .52, .66, .48), 'board': (.025, .19, .12, 1),
    'contact': (.66, .43, .12, 1), 'metal': (.48, .52, .55, 1),
    'chip': (.018, .022, .025, 1), 'sleeve': (.52, .38, .08, 1),
    'fleck': (.65, .83, .86, 1),
}


def material(role):
    existing = bpy.data.materials.get('suite_' + role)
    if existing:
        return existing
    m = bpy.data.materials.new('suite_' + role)
    m.diffuse_color = PALETTE[role]
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = PALETTE[role]
    p.inputs['Roughness'].default_value = .32 if role == 'clear_shell' else .4
    p.inputs['Metallic'].default_value = .8 if role in {'contact', 'metal', 'fleck'} else 0
    if role == 'clear_shell':
        p.inputs['Transmission Weight'].default_value = .65
        p.inputs['IOR'].default_value = 1.46
    return m


def assign(obj, role):
    obj.data.materials.clear()
    obj.data.materials.append(material(role))
    for face in obj.data.polygons:
        face.material_index = 0
    obj.name = role + '_' + obj.name


def box(name, size, center, role, bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Molded edges', 'BEVEL')
        mod.width = min(bevel, min(size) / 3)
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    assign(o, role)
    return o


def disk(name, radius, depth, center, role):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=depth, location=center)
    o = bpy.context.object
    o.name = name
    assign(o, role)
    return o


def import_model(file, kind):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(file))
    objects = [o for o in bpy.data.objects if o.type == 'MESH']
    kept = []
    for o in objects:
        o.data = o.data.copy()
        transform = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(transform)
        names = ' '.join(m.name for m in o.data.materials)
        if kind == 'switch' and any(abs(v.co.y) > 1.12 for v in o.data.vertices):
            bpy.data.objects.remove(o, do_unlink=True)
            continue  # One complete cart from the five-cart scene.
        if names in {'gblabel', 'presetNdsiCartridgeFront4'} or (kind == 'switch' and len(o.data.vertices) == 4):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        role = 'contact' if 'metal' in names.lower() or names == 'Motherboard' else 'metal' if names == 'triscrew' else 'shell'
        assign(o, role)
        for v in o.data.vertices:
            x, y, z = v.co
            if kind == 'gb':
                v.co = (x, z, -y)
            elif kind == 'gba':
                v.co = (z, -x, -y)
            elif kind == 'gba-alternative':
                v.co = (-y, z, x)
            elif kind == 'switch':
                v.co = (y, -x, z)
        kept.append(o)
    for o in list(bpy.data.objects):
        if o not in kept:
            bpy.data.objects.remove(o, do_unlink=True)
    size = {'gb': (1.72, 1.98, .23), 'gba': (2.25, 1.33, .25),
            'gba-alternative': (2.25, 1.33, .25), 'nds': (1.72, 1.85, .15),
            '3ds': (1.78, 1.85, .17), 'switch': (1.26, 1.85, .16)}[kind]
    points = [v.co.copy() for o in kept for v in o.data.vertices]
    lo = Vector([min(v[i] for v in points) for i in range(3)])
    hi = Vector([max(v[i] for v in points) for i in range(3)])
    center = (lo + hi) / 2
    for o in kept:
        for v in o.data.vertices:
            v.co = Vector([(v.co[i] - center[i]) * size[i] / (hi[i] - lo[i]) for i in range(3)])
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(o.data)
        bm.free()
        # glTF custom normals no longer match after the axis/scale conversion.
        # Preserve hard planar faces instead of interpolating across case edges.
        bpy.context.view_layer.objects.active = o
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        for polygon in o.data.polygons:
            polygon.use_smooth = False
    # Discard all source images and materials; only geometry is redistributed.
    for im in list(bpy.data.images):
        bpy.data.images.remove(im)
    for m in list(bpy.data.materials):
        if not m.name.startswith('suite_'):
            bpy.data.materials.remove(m)
    return kept


def crystal_from_gb():
    """Adapt Bob's imported GB mesh, retaining its lower shell and label recess."""
    source = next(o for o in bpy.data.objects if o.type == 'MESH')
    source.name = 'crystal_front_from_game_boy'
    for v in source.data.vertices:
        # Fill the DMG's upper-right lock notch; Crystal's top is continuous.
        if v.co.x > .55 and v.co.y > .74 and v.co.y < .92:
            v.co.y = min(.99, v.co.y + .15)
        # Thin front panel leaves room for a real interior, rather than an opaque block.
        v.co.z = .087 + (v.co.z + .115) * .12
    assign(source, 'clear_shell')
    bm = bmesh.new(); bm.from_mesh(source.data)
    # Keep Bob's lower chassis and recess; replace the DMG header completely.
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                          plane_co=(0, .43, 0), plane_no=(0, 1, 0),
                          clear_outer=True, clear_inner=False, dist=.00001)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0001)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.0001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(source.data); bm.free()
    rear = source.copy(); rear.data = source.data.copy()
    bpy.context.collection.objects.link(rear); rear.name = 'crystal_rear_from_game_boy'
    for v in rear.data.vertices:
        v.co.z = -v.co.z
    bm = bmesh.new(); bm.from_mesh(rear.data)
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.to_mesh(rear.data); bm.free()
    # Convex upper face, unlike the original Game Boy's inset header.
    verts, faces = [], []
    cols, rows = 32, 8
    for j in range(rows + 1):
        y = .43 + j / rows * .55
        for i in range(cols + 1):
            # Rounded upper corners; the top has no Game Boy locking notch.
            inset = .08 - math.sqrt(max(0, .08**2 - max(0, y-.90)**2)) if y > .90 else 0
            half = .86 - inset
            x = -half + i / cols * half * 2
            z = .116 + .045 * math.sin(math.pi * i / cols) * math.sin(math.pi * j / rows) ** .35
            verts.append((x, y, z))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a+1, a+cols+2, a+cols+1))
    mesh = bpy.data.meshes.new('convex_header'); mesh.from_pydata(verts, [], faces); mesh.update()
    raised = bpy.data.objects.new('convex_header', mesh); bpy.context.collection.objects.link(raised)
    assign(raised, 'clear_shell')
    for p in raised.data.polygons: p.use_smooth = True
    back = raised.copy(); back.data = raised.data.copy(); bpy.context.collection.objects.link(back)
    back.name = 'rounded_rear_header'
    for v in back.data.vertices: v.co.z = -.112
    bm = bmesh.new(); bm.from_mesh(back.data)
    bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.to_mesh(back.data); bm.free()
    for x in [-.84, .84]: box('case_side', (.035, 1.91, .22), (x, -.02, 0), 'clear_shell')
    box('case_top', (1.66, .035, .22), (0, .962, 0), 'clear_shell')
    box('case_seam', (1.66, .012, .014), (0, -.97, 0), 'trim', .002)
    box('circuit_board', (1.54, 1.77, .028), (0, -.025, -.015), 'board')
    disk('battery_insulator', .247, .025, (.38, .57, .018), 'sleeve')
    disk('battery', .228, .035, (.38, .57, .038), 'metal')
    box('battery_tab', (.065, .34, .013), (.38, .43, .062), 'metal', .002)
    for x, y, w, h in [(-.31,.50,.33,.31),(-.30,-.21,.36,.55),(.35,-.24,.36,.44)]:
        box('memory_chip', (w,h,.046), (x,y,.024), 'chip')
        for side in [-1,1]:
            for pin in range(9):
                box('chip_pin', (.032,.017,.012), (x+side*(w/2+.012), y-h*.42+pin*h*.105, .02), 'metal', 0)
    for i in range(32): box('contact', (.033,.15,.007), ((i-15.5)*.045, -.826, .008), 'contact', .001)
    # Geometry flecks catch the light without any copied texture or label pixels.
    rng = random.Random(251)
    fv, ff = [], []
    for _ in range(1500):
        x, y = rng.uniform(-.82,.82), rng.uniform(-.95,.95)
        if abs(x)<.68 and -.84<y<.40: continue  # Opaque paper label.
        z = .119
        if .43<y<.98:
            z += .045*math.sin(math.pi*(x+.86)/1.72)*math.sin(math.pi*(y-.43)/.55)**.35
        r=rng.uniform(.001,.0034); n=len(fv)
        fv.extend([(x-r,y-r,z),(x+r,y-r,z+.0004),(x,y+r,z)])
        ff.append((n,n+1,n+2))
    mesh=bpy.data.meshes.new('plastic_flecks');mesh.from_pydata(fv,[],ff);mesh.update()
    o=bpy.data.objects.new('plastic_flecks',mesh);bpy.context.collection.objects.link(o);assign(o,'fleck')


def export_model(output, kind):
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        if o.type == 'MESH': o.select_set(True)
    bpy.ops.wm.obj_export(filepath=str(output/(kind+'.obj')), export_selected_objects=True,
                          forward_axis='Y', up_axis='Z', export_materials=True,
                          export_triangulated_mesh=True, export_uv=False)
    # No textures, scene cameras, or third-party label images in the editable source.
    bpy.ops.wm.save_as_mainfile(filepath=str(output/(kind+'.blend')))
    objects=[o for o in bpy.data.objects if o.type=='MESH']
    return {'vertices':sum(len(o.data.vertices) for o in objects),
            'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),
            'sha256':hashlib.sha256((output/(kind+'.obj')).read_bytes()).hexdigest()}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--downloads',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    sources={'gb':args.downloads/'gb.glb','gba':args.downloads/'gba/scene.gltf',
             'nds':args.downloads/'ds/scene.gltf','3ds':args.downloads/'3ds.glb','switch':args.downloads/'switch/scene.gltf'}
    report={}
    for kind,file in sources.items():
        import_model(file,kind);report[kind]=export_model(args.output,kind)
        if kind=='gb':
            crystal_from_gb();report['crystal']=export_model(args.output,'crystal')
    (args.output/'geometry.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
