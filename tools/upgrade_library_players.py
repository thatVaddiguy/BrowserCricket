"""Run inline through Blender MCP after build_cricket_assets.py and importing Sports_Male_01.fbx.

Adapt the MIT-licensed Rocketbox sports avatar to our cricket bind pose.
The library's facial/hand topology, UVs and blended skin weights are retained.
Finger/facial weights collapse into hand/head bones; cricket action clocks stay unchanged.
Original procedural bodies remain in the workshop but are excluded from game exports.
"""
import bpy
import math
from mathutils import Vector, Matrix

ROOT = "/home/berkshiregrey.com/rohit.vaddi/Desktop/cricketGame"
scene = bpy.context.scene
# FBX import resets the scene to 30fps. Our contact/bowling clips were authored at 200fps.
scene.render.fps = 200
scene.render.fps_base = 1
scene.frame_set(1)
source = bpy.data.objects["m021_hipoly_81_bones"]
library_rig = bpy.data.objects["Bip01"]
target = bpy.data.objects["Batter_Skeleton"]
if any(o.name.startswith("Library_Cricket_Player") for o in scene.objects):
    raise RuntimeError("Library players already exist. Rebuild from the preserved base workshop, not hand-edited library meshes.")


def joint(name):
    return library_rig.matrix_world @ library_rig.data.bones[name].head_local


def mapping(name):
    if " Finger" in name or " Hand" in name:
        return "hand_R" if " L " in name else "hand_L"
    for term, stem in [(" UpperArm", "upper_arm"), (" Forearm", "forearm"),
                       (" Thigh", "thigh"), (" Calf", "shin"),
                       (" Foot", "foot"), (" Toe", "foot")]:
        if term in name:
            return stem + ("_R" if " L " in name else "_L")
    if "Clavicle" in name:
        return "chest"
    return {"Bip01 Pelvis": "hips", "Bip01 Spine": "spine",
            "Bip01 Spine1": "spine", "Bip01 Spine2": "chest",
            "Bip01 Neck": "neck"}.get(name, "head")


def bind_transform(name):
    dest_name = mapping(name)
    dest = target.data.bones[dest_name]
    src_name = name
    if dest_name.startswith("hand"):
        src_name = "Bip01 L Hand" if dest_name.endswith("R") else "Bip01 R Hand"
    elif dest_name.startswith("foot"):
        src_name = "Bip01 L Foot" if dest_name.endswith("R") else "Bip01 R Foot"
    elif dest_name == "head":
        src_name = "Bip01 Head"
    elif "Clavicle" in name:
        src_name = "Bip01 Spine2"
    start = joint(src_name)
    end_name = src_name.replace("UpperArm", "Forearm").replace("Forearm", "Hand") if "Forearm" in src_name else src_name.replace("UpperArm", "Forearm")
    if " Thigh" in src_name:
        end_name = src_name.replace("Thigh", "Calf")
    if " Calf" in src_name:
        end_name = src_name.replace("Calf", "Foot")
    if " Hand" in src_name:
        end_name = src_name.replace("Hand", "Finger22")
    if " Foot" in src_name:
        end_name = src_name.replace("Foot", "Toe0")
    if dest_name.startswith(("upper_arm", "forearm", "hand", "thigh", "shin", "foot")):
        direction = joint(end_name) - start
        desired = dest.tail_local - dest.head_local
        rotation = direction.rotation_difference(desired).to_matrix().to_4x4()
        # Keep anatomical width and hand size instead of uniformly shrinking the limb.
        axis = direction.normalized()
        length_scale = desired.length / direction.length
        if dest_name.startswith("hand"):
            length_scale = 0.9
        stretch = Matrix.Identity(4)
        for i in range(3):
            for j in range(3):
                stretch[i][j] += (length_scale - 1) * axis[i] * axis[j]
        return Matrix.Translation(dest.head_local) @ rotation @ stretch @ Matrix.Translation(-start)
    offset = dest.head_local - start
    if src_name == "Bip01 Spine1":
        offset = Vector((0, 0, 1.17)) - start
    return Matrix.Translation(offset)


transforms = {group.index: bind_transform(group.name) for group in source.vertex_groups}
groups = {group.index: mapping(group.name) for group in source.vertex_groups}
vertices, weights = [], []
for vertex in source.data.vertices:
    position = source.matrix_world @ vertex.co
    blended = Vector((0, 0, 0))
    converted = {}
    for weight in vertex.groups:
        blended += (transforms[weight.group] @ position) * weight.weight
        bone = groups[weight.group]
        converted[bone] = converted.get(bone, 0) + weight.weight
    total = sum(converted.values())
    vertices.append(blended / total if total else position)
    weights.append({name: value / total for name, value in converted.items()} if total else {"hips": 1})


def textured_material(name, image_name, normal_name=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Roughness"].default_value = 0.8
    image = bpy.data.images.load(ROOT + "/assets/library/rocketbox/" + image_name, check_existing=True)
    image.pack()
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    mat.node_tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    if normal_name:
        normal = bpy.data.images.load(ROOT + "/assets/library/rocketbox/" + normal_name, check_existing=True)
        normal.colorspace_settings.name = "Non-Color"
        normal.pack()
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = normal
        bump = mat.node_tree.nodes.new("ShaderNodeNormalMap")
        bump.inputs["Strength"].default_value = 0.35
        mat.node_tree.links.new(tex.outputs["Color"], bump.inputs["Color"])
        mat.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


head_mat = textured_material("Rocketbox_Head_MIT", "m021_head_color.jpg", "m021_head_normal.png")
skin_mat = textured_material("Rocketbox_Skin_MIT", "m021_body_color.jpg")


def clip_polygon(corners, height, above):
    result = []
    for index, a in enumerate(corners):
        b = corners[(index + 1) % len(corners)]
        inside_a = a[0].z >= height if above else a[0].z <= height
        inside_b = b[0].z >= height if above else b[0].z <= height
        if inside_a:
            result.append(a)
        if inside_a != inside_b:
            t = (height - a[0].z) / (b[0].z - a[0].z)
            weight = {name: a[2].get(name, 0) * (1 - t) + b[2].get(name, 0) * t
                      for name in set(a[2]) | set(b[2])}
            result.append((a[0].lerp(b[0], t), a[1].lerp(b[1], t), weight))
    return result


# Split faces at clothing hems, rather than jagged per-triangle colour assignments.
split_vertices, split_weights, split_faces, split_uvs = [], [], [], []
lookup = {}
for polygon in source.data.polygons:
    corners = [(vertices[vi], source.data.uv_layers.active.data[li].uv.copy(), weights[vi])
               for vi, li in zip(polygon.vertices, polygon.loop_indices)]
    pieces = [corners]
    for height in [1.04, 1.25, 1.49]:
        next_pieces = []
        for piece in pieces:
            if min(c[0].z for c in piece) < height < max(c[0].z for c in piece):
                next_pieces.extend([clip_polygon(piece, height, False), clip_polygon(piece, height, True)])
            else:
                next_pieces.append(piece)
        pieces = next_pieces
    for piece in pieces:
        ids = []
        for position, uv, weight in piece:
            key = tuple(round(v, 6) for v in position)
            if key not in lookup:
                lookup[key] = len(split_vertices)
                split_vertices.append(position)
                split_weights.append(weight)
            ids.append(lookup[key])
        split_faces.append(tuple(ids))
        split_uvs.extend(c[1] for c in piece)
vertices, weights = split_vertices, split_weights

for rig_name, output, kit_name in [
    ("Batter_Skeleton", "batter.glb", "Kit_Fabric"),
    ("Fielder_Skeleton", "fielder.glb", "Fielding_Fabric"),
]:
    rig = bpy.data.objects[rig_name]
    data = bpy.data.meshes.new("Rocketbox_Cricket_Anatomy")
    data.from_pydata(vertices, [], split_faces)
    data.update()
    obj = bpy.data.objects.new("Library_Cricket_Player_" + output.split(".")[0], data)
    scene.collection.objects.link(obj)
    obj.parent = rig
    obj["asset_source"] = "Microsoft Rocketbox / Sports_Male_01 / MIT"
    materials = [skin_mat, head_mat, bpy.data.materials[kit_name],
                 bpy.data.materials["Trousers_Weave"], bpy.data.materials["Protective_Leather"]]
    for mat in materials:
        data.materials.append(mat)
    uv = data.uv_layers.new(name="Rocketbox_UV")
    for loop in data.loops:
        uv.data[loop.index].uv = split_uvs[loop.index]
    for polygon in data.polygons:
        totals = {}
        for vi in polygon.vertices:
            for bone, weight in weights[vi].items():
                totals[bone] = totals.get(bone, 0) + weight
        main = max(totals, key=totals.get)
        z = sum(vertices[vi].z for vi in polygon.vertices) / len(polygon.vertices)
        if main.startswith("hand"):
            polygon.material_index = 4 if output == "batter.glb" else 0
        elif main.startswith(("forearm", "upper_arm")) and z < 1.25:
            polygon.material_index = 0
        elif z > 1.49:
            polygon.material_index = 1
        elif main.startswith("foot") and z < .11:
            polygon.material_index = 4
        elif z < 1.04 and not main.startswith("upper_arm"):
            polygon.material_index = 3
        else:
            polygon.material_index = 2
        polygon.use_smooth = True
    for bone in rig.data.bones:
        group = obj.vertex_groups.new(name=bone.name)
        for vi, converted in enumerate(weights):
            if bone.name in converted:
                group.add([vi], converted[bone.name], "REPLACE")
    modifier = obj.modifiers.new("Library_Weighted_Cricket_Rig", "ARMATURE")
    modifier.object = rig
    for old in rig.children:
        if old.name.startswith("Player_Uniform"):
            old.hide_render = True
            old.hide_set(True)
    saved_location = rig.location.copy()
    rig.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for child in rig.children:
        if not child.name.startswith("Player_Uniform"):
            child.select_set(True)
    bpy.context.view_layer.objects.active = rig
    mode = next(i.identifier for i in bpy.ops.export_scene.gltf.get_rna_type().properties["export_animation_mode"].enum_items if i.identifier == "NLA_TRACKS")
    bpy.ops.export_scene.gltf(filepath=ROOT + "/public/models/" + output,
        export_format="GLB", use_selection=True, use_active_scene=True, export_yup=True,
        export_animations=True, export_animation_mode=mode,
        export_force_sampling=True, export_frame_step=1)
    rig.location = saved_location
    print(output, len(data.vertices), "library vertices; original cricket equipment and clips retained")
library_rig.hide_render = True
source.hide_render = True
library_rig.hide_set(True)
source.hide_set(True)
bpy.ops.wm.save_as_mainfile(filepath=ROOT + "/assets/blender/cricket-library-players.blend", copy=True)
