"""Run in Blender through MCP. Original CC0 cricket assets; no downloads.

Creates a separate scene, leaving the user's existing scene untouched.
Blender's Z-up / -Y-forward is converted by the glTF exporter to Y-up / +Z.
"""
import bpy
import math
import json
import random
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/models"
OUT.mkdir(parents=True, exist_ok=True)
SCENE_NAME = "Crease_Asset_Workshop"
if bpy.data.scenes.get(SCENE_NAME):
    raise RuntimeError("Workshop already exists; rename it before rebuilding to preserve edits.")
scene = bpy.data.scenes.new(SCENE_NAME)
bpy.context.window.scene = scene
scene.render.fps = 200  # Exact key at the engine's 0.105-second contact point.
scene.unit_settings.scale_length = 1


def material(name, color, roughness=.8, texture=None, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if texture:
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = texture
        mat.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    return mat


def surface(name, base, style):
    """Pack real image maps, so the exported materials work without Blender nodes."""
    n = 256
    rng = random.Random(74)
    pixels = []
    for y in range(n):
        for x in range(n):
            noise = rng.gauss(0, .018)
            if style == "fabric":
                noise += .022 * ((x % 4 == 0) + (y % 4 == 0))
                noise += .025 * math.sin(y * .11) * math.sin(x * .055)
            elif style == "wood":
                noise += .06 * math.sin(x * .3 + math.sin(y * .02) * 1.4)
                noise += .015 * math.sin(x * 1.2)
            else:
                noise += .009 * math.sin(x * .3) * math.cos(y * .28)
            pixels.extend([max(0, min(1, value + noise)) for value in base] + [1])
    image = bpy.data.images.new(name, width=n, height=n)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(OUT / (name + ".png"))
    image.file_format = next(i.identifier for i in image.bl_rna.properties["file_format"].enum_items
                             if i.identifier == "PNG")
    image.save()
    image.pack()
    return image


skin = material("Skin_Pores", (1, 1, 1), .68, surface("skin", (.55, .34, .22), "skin"))
shirt = material("Kit_Fabric", (1, 1, 1), .87, surface("kit", (.15, .34, .48), "fabric"))
field_shirt = material("Fielding_Fabric", (1, 1, 1), .87,
                       surface("fielding-kit", (.62, .23, .105), "fabric"))
pants = material("Trousers_Weave", (1, 1, 1), .88, surface("trousers", (.79, .80, .74), "fabric"))
white = material("Protective_Leather", (.92, .93, .86), .65)
navy = material("Helmet_Navy", (.022, .065, .105), .32)
rubber = material("Sole_Rubber", (.035, .042, .047), .94)
hair = material("Hair", (.036, .023, .017), .96)
eye = material("Eyes", (.83, .79, .69), .32)
iris = material("Iris", (.047, .028, .014), .28)
lip = material("Lips", (.29, .12, .083), .77)
metal = material("Steel_Grille", (.40, .46, .48), .27, metallic=.8)
willow = material("Willow_Grain", (1, 1, 1), .54, surface("willow", (.83, .69, .44), "wood"))
accent = material("Kit_Trim", (.80, .64, .23), .8)


def mesh_builder():
    return {name: [] for name in ["vertices", "faces", "uvs", "weights", "materials", "face_materials"]}


def mesh_rings(m, rings, mat, weights, sides=20):
    """Elliptical cross-sections with longitudinal UVs and blended skin weights."""
    start = len(m["vertices"])
    for k, (center, rx, ry) in enumerate(rings):
        for j in range(sides + 1):
            angle = j / sides * math.tau
            m["vertices"].append((center[0] + rx * math.cos(angle),
                                  center[1] + ry * math.sin(angle), center[2]))
            m["uvs"].append((j / sides, k / max(1, len(rings) - 1)))
            m["weights"].append(weights[k] if isinstance(weights, list) else weights)
    mi = mat_index(m, mat)
    for k in range(len(rings) - 1):
        for j in range(sides):
            a = start + k * (sides + 1) + j
            m["faces"].append((a, a + 1, a + sides + 2, a + sides + 1))
            m["face_materials"].append(mi)
    for row, reverse in [(0, True), (len(rings) - 1, False)]:
        ids = tuple(start + row * (sides + 1) + j for j in range(sides))
        m["faces"].append(ids[::-1] if reverse else ids)
        m["face_materials"].append(mi)

def mat_index(m, mat):
    if mat not in m["materials"]:
        m["materials"].append(mat)
    return m["materials"].index(mat)

def ellipsoid(m, center, scale, mat, bone="head", sides=16, steps=10):
    rings = []
    for i in range(steps + 1):
        a = -.5 * math.pi + math.pi * i / steps
        rings.append(((center[0], center[1], center[2] + scale[2] * math.sin(a)),
                      max(.001, scale[0] * math.cos(a)), max(.001, scale[1] * math.cos(a))))
    mesh_rings(m, rings, mat, {bone: 1}, sides)

def tube(m, a, b, radii, mat, bones, sides=16):
    # Cross-sections in the limb's local perpendicular plane.
    a, b = Vector(a), Vector(b)
    direction = (b - a).normalized()
    u = direction.cross(Vector((0, 1, 0))).normalized()
    v = direction.cross(u).normalized()
    start = len(m["vertices"])
    for k, radius in enumerate(radii):
        t = k / (len(radii) - 1)
        center = a.lerp(b, t)
        weights = bones if isinstance(bones, dict) else {bones[0]: 1 - t, bones[1]: t}
        for j in range(sides + 1):
            angle = j / sides * math.tau
            point = center + u * radius * math.cos(angle) + v * radius * .86 * math.sin(angle)
            m["vertices"].append(tuple(point))
            m["weights"].append(weights)
            m["uvs"].append((j / sides, t))
    mi = mat_index(m, mat)
    for k in range(len(radii) - 1):
        for j in range(sides):
            x = start + k * (sides + 1) + j
            m["faces"].append((x, x + 1, x + sides + 2, x + sides + 1))
            m["face_materials"].append(mi)
    # Capped ends; no open holes in gloves, railings, limbs.
    for k, flip in [(0, True), (len(radii) - 1, False)]:
        ids = tuple(start + k * (sides + 1) + j for j in range(sides))
        m["faces"].append(ids[::-1] if flip else ids)
        m["face_materials"].append(mi)

def make_object(m, name, rig=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(m["vertices"], [], m["faces"])
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    for mat in m["materials"]:
        data.materials.append(mat)
    uv = data.uv_layers.new(name="UVMap")
    for polygon, mi in zip(data.polygons, m["face_materials"]):
        polygon.material_index = mi
        polygon.use_smooth = True
        for index in polygon.loop_indices:
            uv.data[index].uv = m["uvs"][data.loops[index].vertex_index]
    if rig:
        for bone in rig.data.bones:
            group = obj.vertex_groups.new(name=bone.name)
            for i, weights in enumerate(m["weights"]):
                if weights.get(bone.name, 0) > .00001:
                    group.add([i], weights[bone.name], "REPLACE")
        modifier = obj.modifiers.new("Skeleton", "ARMATURE")
        modifier.object = rig
        obj.parent = rig
    return obj


def skeleton(name):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    definitions = {
        "root": ((0, 0, 0), (0, 0, .15), None),
        "hips": ((0, 0, .91), (0, 0, 1.04), "root"),
        "spine": ((0, 0, 1.04), (0, 0, 1.25), "hips"),
        "chest": ((0, 0, 1.25), (0, 0, 1.49), "spine"),
        "neck": ((0, 0, 1.49), (0, 0, 1.59), "chest"),
        "head": ((0, 0, 1.59), (0, 0, 1.80), "neck"),
        "bat": ((.38, -.015, .91), (.38, -.015, 1.11), "root"),
    }
    for side, sign in [("L", -1), ("R", 1)]:
        definitions.update({
            "upper_arm_" + side: ((sign * .225, 0, 1.46), (sign * .335, -.008, 1.17), "chest"),
            "forearm_" + side: ((sign * .335, -.008, 1.17), (sign * .38, -.015, .91), "upper_arm_" + side),
            "hand_" + side: ((sign * .38, -.015, .91), (sign * .38, -.015, .815), "forearm_" + side),
            "thigh_" + side: ((sign * .115, 0, .91), (sign * .14, -.005, .51), "hips"),
            "shin_" + side: ((sign * .14, -.005, .51), (sign * .14, .008, .105), "thigh_" + side),
            "foot_" + side: ((sign * .14, .008, .105), (sign * .14, -.16, .06), "shin_" + side),
        })
    for name, (head, tail, parent) in definitions.items():
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for bone in obj.pose.bones:
        bone.rotation_mode = "QUATERNION"
    return obj


def human(rig, batter=True, low=False):
    m = mesh_builder()
    sides = 10 if low else 24
    kit = shirt if batter or low else field_shirt
    # Athletic silhouette: pelvis, waist, ribcage, shoulders, collar.
    rings = [((0, 0, z), rx, ry) for z, rx, ry in [
        (.84, .155, .115), (.92, .173, .125), (1.01, .155, .108),
        (1.10, .163, .112), (1.21, .185, .128), (1.33, .214, .137),
        (1.42, .225, .129), (1.48, .19, .098), (1.51, .083, .07)]]
    w = [{"hips": 1}, {"hips": 1}, {"hips": .5, "spine": .5},
         {"spine": 1}, {"spine": .45, "chest": .55}, {"chest": 1},
         {"chest": 1}, {"chest": 1}, {"chest": .5, "neck": .5}]
    mesh_rings(m, rings, kit, w, sides)
    mesh_rings(m, [((0, 0, 1.50), .062, .061), ((0, 0, 1.60), .057, .065)],
            skin, {"neck": 1}, sides)
    # Jaw, cheekbones, brow and cranium, not a spherical head.
    mesh_rings(m, [((0, y, z), rx, ry) for z, rx, ry, y in [
        (1.57, .036, .048, -.024), (1.60, .073, .063, -.015),
        (1.64, .091, .079, -.003), (1.69, .101, .088, 0),
        (1.73, .101, .093, .002), (1.77, .094, .088, .008),
        (1.81, .071, .071, .009), (1.825, .023, .022, .009)]],
        skin, {"head": 1}, 10 if low else 32)
    ellipsoid(m, (0, .013, 1.793), (.092, .085, .04), hair, sides=sides, steps=6)
    for sign in [-1, 1]:
        ellipsoid(m, (sign * .101, .005, 1.692), (.018, .022, .031), skin, sides=8, steps=6)
        ellipsoid(m, (sign * .040, -.086, 1.713), (.0156, .010, .0082), eye, sides=8, steps=6)
        ellipsoid(m, (sign * .040, -.095, 1.713), (.0061, .004, .0061), iris, sides=8, steps=6)
        if not low:
            tube(m, (sign * .018, -.091, 1.734), (sign * .064, -.080, 1.734),
                   [.004, .006, .004], hair, {"head": 1}, 8)
    ellipsoid(m, (0, -.098, 1.686), (.018, .027, .030), skin, sides=10, steps=8)
    ellipsoid(m, (0, -.079, 1.642), (.030, .008, .005), lip, sides=10, steps=6)
    for side, sign in [("L", -1), ("R", 1)]:
        ua, fa, hand = "upper_arm_" + side, "forearm_" + side, "hand_" + side
        thigh, shin, foot = "thigh_" + side, "shin_" + side, "foot_" + side
        shoulder = (sign * .225, 0, 1.46)
        elbow = (sign * .335, -.008, 1.17)
        wrist = (sign * .38, -.015, .91)
        tube(m, shoulder, elbow, [.079, .086, .074, .061, .045], skin, {ua: 1}, sides)
        sleeve_end = Vector(shoulder).lerp(Vector(elbow), .6)
        tube(m, shoulder, sleeve_end, [.087, .09, .079, .071], kit, {ua: 1}, sides)
        ellipsoid(m, (sign * .221, 0, 1.448), (.091, .099, .083), kit, ua, sides=16, steps=10)
        tube(m, elbow, wrist, [.046, .060, .054, .042, .029], skin, {fa: 1}, sides)
        ellipsoid(m, (sign * .382, -.02, .865), (.040, .027, .06),
                    white if batter else skin, hand, sides=10, steps=8)
        if not low:
            for finger in range(4):
                x = sign * .382 + (finger - 1.5) * .017
                tube(m, (x, -.04, .858), (x, -.035, .802 + abs(finger - 1.5) * .007),
                       [.010, .012, .008], white if batter else skin, {hand: 1}, 8)
            tube(m, (sign * .351, -.02, .89), (sign * .332, -.049, .852),
                   [.013, .015, .011], white if batter else skin, {hand: 1}, 8)
        hip, knee, ankle = (sign * .115, 0, .91), (sign * .14, -.005, .51), (sign * .14, .008, .105)
        tube(m, hip, knee, [.104, .114, .100, .083, .068], pants, {thigh: 1}, sides)
        tube(m, knee, ankle, [.069, .077, .073, .056, .049], pants, {shin: 1}, sides)
        ellipsoid(m, (sign * .14, -.065, .072), (.067, .147, .059), white, foot, sides=12, steps=8)
        ellipsoid(m, (sign * .14, -.070, .026), (.069, .149, .023), rubber, foot, sides=12, steps=6)
        if not low:
            for i in range(3):
                tube(m, (sign * .14 - .037, -.05 - i * .021, .121 - i * .006),
                       (sign * .14 + .037, -.05 - i * .021, .121 - i * .006),
                       [.004, .004], navy, {foot: 1}, 6)
    # Collar, shoulder piping and button placket.
    if not low:
        for sign in [-1, 1]:
            tube(m, (sign * .067, -.065, 1.50), (sign * .106, -.109, 1.438),
                   [.013, .015, .009], accent, {"chest": 1}, 10)
        tube(m, (0, -.129, 1.31), (0, -.129, 1.438), [.010, .010], navy, {"chest": 1}, 8)
        for z in [1.338, 1.378, 1.418]:
            ellipsoid(m, (0, -.141, z), (.005, .003, .005), white, "chest", sides=6, steps=4)
    body = make_object(m, "Player_Uniform" if not low else "Spectator_Base", rig)
    if batter:
        equipment(rig)
    return body


def equipment(rig):
    m = mesh_builder()
    # Shell follows the cranium, an open face with a curved projecting brim.
    mesh_rings(m, [((0, .011, z), rx, ry) for z, rx, ry in [
        (1.748, .111, .106), (1.785, .109, .106), (1.822, .089, .084),
        (1.854, .049, .047), (1.863, .002, .002)]], navy, {"head": 1}, 32)
    ellipsoid(m, (0, -.115, 1.762), (.112, .061, .012), navy, sides=24, steps=6)
    for z in [1.628, 1.681, 1.731]:
        # Grille shaped around the face instead of flat horizontal bars.
        for a, b in [((-.115, -.075, z), (-.094, -.150, z)),
                     ((-.094, -.150, z), (.094, -.150, z)),
                     ((.094, -.150, z), (.115, -.075, z))]:
            tube(m, a, b, [.0045, .0045], metal, {"head": 1}, 8)
    for x in [-.098, .098]:
        tube(m, (x, -.147, 1.628), (x, -.147, 1.755), [.004, .004], metal, {"head": 1}, 8)
    for side, sign in [("L", -1), ("R", 1)]:
        bone = "shin_" + side
        ellipsoid(m, (sign * .14, -.070, .315), (.095, .050, .245), white, bone, sides=16, steps=12)
        for i in range(6):
            x = sign * .14 + (i - 2.5) * .026
            ellipsoid(m, (x, -.113, .31), (.011, .014, .203), white, bone, sides=8, steps=8)
        ellipsoid(m, (sign * .14, -.089, .533), (.088, .051, .062), white, bone, sides=16, steps=8)
        for z in [.20, .40]:
            tube(m, (sign * .14 - .09, .022, z), (sign * .14 + .09, .022, z),
                   [.010, .010], navy, {bone: 1}, 8)
    make_object(m, "Helmet_Gloves_Pads", rig)
    b = mesh_builder()
    # Full-sized .86m bat, rounded toe, shoulder, rear spine, wrapped cane handle.
    grip = Vector((.38, -.015, .91))
    tube(b, grip + Vector((0, 0, .09)), grip + Vector((0, 0, -.19)),
           [.015, .016, .017], navy, {"bat": 1}, 16)
    for i in range(15):
        z = .97 - i * .014
        ellipsoid(b, (.38, -.015, z), (.018, .018, .003), rubber, "bat", sides=12, steps=4)
    mesh_rings(b, [((.38, -.015 + offset, z), rx, ry) for z, rx, ry, offset in [
        (.15, .028, .017, 0), (.175, .051, .022, 0), (.24, .054, .029, .002),
        (.52, .054, .033, .008), (.68, .052, .031, .009),
        (.73, .040, .025, .004), (.77, .021, .018, 0)]],
        willow, {"bat": 1}, 16)
    ellipsoid(b, (.38, -.045, .58), (.039, .002, .060), navy, "bat", sides=12, steps=6)
    ellipsoid(b, (.38, -.047, .59), (.029, .002, .004), accent, "bat", sides=10, steps=4)
    make_object(b, "Willow_Bat", rig)


def reset_pose(rig):
    for bone in rig.pose.bones:
        bone.location = (0, 0, 0)
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.scale = (1, 1, 1)


def rotate(rig, name, x=0, y=0, z=0):
    from mathutils import Euler
    rig.pose.bones[name].rotation_quaternion = Euler((x, y, z)).to_quaternion()


def point_bone(rig, name, a, b):
    bone = rig.pose.bones[name]
    orient = (Vector(b) - Vector(a)).to_track_quat("Y", "Z").to_matrix().to_4x4()
    bone.matrix = Matrix.Translation(Vector(a)) @ orient
    bpy.context.view_layer.update()


def reach(rig, side, target):
    """Bake two-bone arm IK. Both gloves really grip the bat during the stroke."""
    upper = rig.pose.bones["upper_arm_" + side]
    fore = rig.pose.bones["forearm_" + side]
    bpy.context.view_layer.update()
    a = upper.head.copy()
    target = Vector(target)
    l1, l2 = upper.length, fore.length
    delta = target - a
    d = max(.04, min(delta.length, l1 + l2 - .003))
    axis = delta.normalized()
    along = (l1*l1 - l2*l2 + d*d) / (2*d)
    pole = Vector((-1 if side == "L" else 1, .2, 0))
    pole = (pole - axis * pole.dot(axis)).normalized()
    elbow = a + axis * along + pole * math.sqrt(max(0, l1*l1 - along*along))
    end = a + axis * d
    point_bone(rig, upper.name, a, elbow)
    point_bone(rig, fore.name, elbow, end)


def bat_grip(rig, center, rx, rz):
    from mathutils import Euler
    orientation = Euler((rx, 0, rz)).to_matrix().to_4x4()
    rest = rig.data.bones["bat"].matrix_local.to_quaternion().to_matrix().to_4x4()
    rig.pose.bones["bat"].matrix = Matrix.Translation(Vector(center)) @ orientation @ rest
    reach(rig, "R", Vector(center) + orientation.to_3x3() @ Vector((0, 0, -.04)))
    reach(rig, "L", Vector(center) + orientation.to_3x3() @ Vector((0, 0, .045)))
    for side in ["L", "R"]:
        hand = rig.pose.bones["hand_" + side]
        rest_hand = hand.bone.matrix_local.to_quaternion().to_matrix().to_4x4()
        hand.matrix = Matrix.Translation(hand.head) @ orientation @ rest_hand
        bpy.context.view_layer.update()


def author_clip(rig, name, duration, pose, samples=25):
    reset_pose(rig)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    times = sorted(set([0, duration] + [duration * i / samples for i in range(samples + 1)] +
                       ([.04, .105, .30, .45] if name.startswith(("drive", "defend")) else [])))
    for t in times:
        scene.frame_set(round(t * 200) + 1)
        reset_pose(rig)
        pose(t)
        bpy.context.view_layer.update()
        for bone in rig.pose.bones:
            bone.keyframe_insert("location", frame=round(t * 200) + 1, group=bone.name)
            bone.keyframe_insert("rotation_quaternion", frame=round(t * 200) + 1, group=bone.name)
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, action)
    strip.extrapolation = "NOTHING"
    track.mute = True
    return action


def animations(rig, batter):
    def stance(t):
        rotate(rig, "hips", -.08)
        rotate(rig, "spine", .07)
        rotate(rig, "thigh_L", -.10)
        rotate(rig, "thigh_R", -.12)
        rotate(rig, "shin_L", .16)
        rotate(rig, "shin_R", .17)
        bat_grip(rig, (.10, -.15, 1.07 + .005 * math.sin(t * math.tau / 2)), -.20, -.22)

    def idle(t):
        rotate(rig, "chest", .018 * math.sin(t * math.pi))
        rotate(rig, "forearm_L", -.12)
        rotate(rig, "forearm_R", -.12)

    def run(t):
        a = math.sin(t / .72 * math.tau)
        rig.pose.bones["hips"].location.z = .023 * (1 - abs(a))
        rotate(rig, "spine", .13)
        for side, sign in [("L", 1), ("R", -1)]:
            rotate(rig, "thigh_" + side, a * sign * .70)
            rotate(rig, "shin_" + side, .25 + max(0, a * sign) * 1.05)
            rotate(rig, "upper_arm_" + side, -a * sign * .54)
            rotate(rig, "forearm_" + side, -.85)
        if batter:
            bpy.context.view_layer.update()
            wrist = rig.pose.bones["hand_R"].head.copy()
            rest = rig.data.bones["bat"].matrix_local.to_quaternion().to_matrix().to_4x4()
            rig.pose.bones["bat"].matrix = Matrix.Translation(wrist) @ rig.pose.bones["hand_R"].matrix.to_quaternion().to_matrix().to_4x4() @ rest

    def turn(t):
        run(t)
        rotate(rig, "chest", .10, .0, math.sin(t / .42 * math.pi) * .43)
        rotate(rig, "head", 0, 0, math.sin(t / .42 * math.pi) * -.35)

    def stroke(t, direction):
        stance(t)
        side = -1 if direction == "left" else 1
        if direction == "down":
            q = min(1, t / .105)
            center = Vector((.10, -.15, 1.07)).lerp(Vector((.12, -.25, 1.02)), q)
            bat_grip(rig, center, -.05, 0)
            return
        keys = [(0, (.10, -.15, 1.07), -.20, -.22),
                (.04, (-side * .10, -.02, 1.29), -.55, -side * 1.80),
                (.105, (.53, -.34, 1.13), -.18, 0),
                (.30, (side * .18, -.28, 1.31), -1.1 if direction == "up" else -.28, side * 2.0),
                (.45, (side * .18, -.28, 1.31), -.4, side * 2.0),
                (.62, (.10, -.15, 1.07), -.20, -.22)]
        step = math.sin(t / .21 * math.pi) if t < .21 else 0
        rig.pose.bones["hips"].location.x = .40 * step
        rotate(rig, "spine", .07 + .13 * step)
        for i in range(len(keys) - 1):
            if keys[i][0] <= t <= keys[i + 1][0]:
                a, b = keys[i], keys[i + 1]
                q = (t - a[0]) / (b[0] - a[0])
                q = q*q*(3 - 2*q)
                rotate(rig, "chest", .04, 0, side * .16 * math.sin(t / .62 * math.pi))
                bat_grip(rig, Vector(a[1]).lerp(Vector(b[1]), q),
                         a[2] + (b[2] - a[2]) * q, a[3] + (b[3] - a[3]) * q)
                break

    def bowl(t):
        run(t)
        if t >= 1.35:
            q = min(1, (t - 1.35) / .45)
            rotate(rig, "upper_arm_R", -q * math.pi - max(0, t - 1.8) / .3 * 1.9)
            rotate(rig, "forearm_R", 0)
            rotate(rig, "upper_arm_L", -1.1 * (1 - q))
            rotate(rig, "spine", -.12 + max(0, t - 1.8) * 1.0)

    def pickup(t):
        q = math.sin(min(1, t / .32) * math.pi / 2)
        rotate(rig, "hips", .45 * q)
        rotate(rig, "spine", .50 * q)
        rotate(rig, "thigh_L", -.75 * q)
        rotate(rig, "shin_L", 1.0 * q)
        rotate(rig, "thigh_R", -.55 * q)
        rotate(rig, "shin_R", .75 * q)
        rig.pose.bones["hips"].location.z = -.20 * q
        reach(rig, "R", (.15, -.35, .22 + .68 * (1 - q)))

    def throw(t):
        # Release at t=.12; runtime maps it to pickupSeconds.
        q = min(1, t / .12)
        rotate(rig, "spine", -.2 + .6 * q)
        rotate(rig, "chest", 0, 0, .3 * (1 - q))
        reach(rig, "R", Vector((.26, .25, 1.60)).lerp(Vector((.13, -.36, 1.05)), q))
        rotate(rig, "forearm_L", -.4)

    def catch(t):
        q = min(1, t / .16)
        for side, sign in [("L", -1), ("R", 1)]:
            reach(rig, side, (sign * (.2 - .12*q), -.32, 1.35))

    author_clip(rig, "stance" if batter else "idle", 2, stance if batter else idle)
    author_clip(rig, "run", .72, run, 24)
    author_clip(rig, "turn", .42, turn, 14)
    if batter:
        for direction in ["left", "right", "up", "down"]:
            author_clip(rig, "defend" if direction == "down" else "drive_" + direction,
                        .62, lambda t, d=direction: stroke(t, d), 31)
    else:
        author_clip(rig, "bowl", 2.1, bowl, 70)
        author_clip(rig, "pickup", .32, pickup, 16)
        author_clip(rig, "throw", .42, throw, 21)
        author_clip(rig, "catch", .55, catch, 22)
    reset_pose(rig)


def export_selected(filename, objects, animated=True):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    args = dict(filepath=str(OUT / filename), use_selection=True,
                # Dynamic enum was inspected through MCP: GLB / GLTF_SEPARATE.
                export_format="GLB",
                export_animations=animated, export_skins=animated)
    if animated:
        args.update(export_animation_mode=next(i.identifier for i in props["export_animation_mode"].enum_items
                                              if i.identifier == "NLA_TRACKS"),
                    export_force_sampling=True, export_frame_step=1)
    bpy.ops.export_scene.gltf(**args)


players = []
for name, batter in [("Batter_Skeleton", True), ("Fielder_Skeleton", False)]:
    rig = skeleton(name)
    human(rig, batter)
    animations(rig, batter)
    export_selected("batter.glb" if batter else "fielder.glb", [rig] + list(rig.children))
    players.append(rig)

# Crowd models are baked seated meshes. No thousands of animation mixers or bones.
spectator_rig = skeleton("Spectator_Working_Rig")
spectator = human(spectator_rig, False, low=True)
variants = []
for index in range(3):
    reset_pose(spectator_rig)
    rotate(spectator_rig, "thigh_L", -math.pi / 2)
    rotate(spectator_rig, "thigh_R", -math.pi / 2)
    rotate(spectator_rig, "shin_L", math.pi / 2)
    rotate(spectator_rig, "shin_R", math.pi / 2)
    spectator_rig.pose.bones["hips"].location.z = -.42
    for side, sign in [("L", -1), ("R", 1)]:
        rotate(spectator_rig, "upper_arm_" + side,
               -.3 if index == 0 else -2.5 if index == 1 else -.8, 0, sign * .12)
        rotate(spectator_rig, "forearm_" + side, -.6 if index == 0 else -.3 if index == 1 else -1)
    bpy.context.view_layer.update()
    data = bpy.data.meshes.new_from_object(spectator.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    baked = bpy.data.objects.new("Crowd_" + ["seated", "cheering", "clapping"][index], data)
    scene.collection.objects.link(baked)
    decimate = baked.modifiers.new("Crowd_LOD", "DECIMATE")
    decimate.ratio = .12
    bpy.context.view_layer.objects.active = baked
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    variants.append(baked)
export_selected("crowd.glb", variants, False)
far_variants = []
for source in variants:
    obj = bpy.data.objects.new("Far_" + source.name, source.data.copy())
    scene.collection.objects.link(obj)
    decimate = obj.modifiers.new("Distant_Crowd_LOD", "DECIMATE")
    decimate.ratio = .36
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    far_variants.append(obj)
export_selected("crowd-far.glb", far_variants, False)
for obj in far_variants:
    obj.hide_render = True

# Workshop preview: avoid modifying the original scene, lights or camera.
spectator_rig.hide_render = True
spectator.hide_render = True
for index, rig in enumerate(players):
    rig.location.x = index * 1.1 - .6
    reset_pose(rig)
variants[0].location.x = 1.7
variants[1].location.x = 2.45
variants[2].location.x = 3.2
for rig in players:
    rig.animation_data.nla_tracks[0].mute = False
scene.frame_set(1)
for location, energy, size in [((1, -4, 5), 600, 4), ((-3, 1, 4), 500, 3)]:
    light_data = bpy.data.lights.new("Workshop_Softbox", type="AREA")
    light_data.energy, light_data.shape, light_data.size = energy, "DISK", size
    light_obj = bpy.data.objects.new(light_data.name, light_data)
    scene.collection.objects.link(light_obj)
    light_obj.location = location
    light_obj.rotation_euler = (Vector((.8, 0, 1)) - light_obj.location).to_track_quat("-Z", "Y").to_euler()
world = bpy.data.worlds.new("Workshop_World")
world.use_nodes = True
background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
background.inputs["Color"].default_value = (.12, .16, .20, 1)
background.inputs["Strength"].default_value = .6
scene.world = world
camera_data = bpy.data.cameras.new("Workshop_Camera")
camera = bpy.data.objects.new(camera_data.name, camera_data)
scene.collection.objects.link(camera)
camera.location = (3.5, -6, 3)
camera.rotation_euler = (Vector((1, 0, .95)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 4.8
scene.camera = camera
scene.render.resolution_x, scene.render.resolution_y = 1100, 700
scene.render.resolution_percentage = 100
scene.render.filepath = str(ROOT / "assets/blender/workshop-preview.png")
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "assets/blender/cricket-characters.blend"), copy=True)
manifest = {
    "license": "CC0-1.0",
    "authoring": "Original meshes, UV textures, weighted skeletons and baked actions authored in Blender via MCP.",
    "meters": True,
    "contactSeconds": .105,
    "pickupSeconds": .32,
    "files": {p.name: p.stat().st_size for p in OUT.glob("*.glb")},
    "bones": len(players[0].data.bones),
    "crowdVariants": [v.name for v in variants],
}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest))
