"""Blender 4.5.3: blender -b --python build-rocketbox.py -- SOURCE_DIR OUTPUT.glb

Source: Microsoft-Rocketbox @ 0943055db6ec570bcef9f2c8b41c9e5467c808f9,
Assets/Avatars/Professions/Business_Male_01 (facial FBX + Textures), MIT.
Input directory also contains 1024px head.jpg/body.jpg and 512px opacity.png
converted from the credited TGA textures. No runtime Blender dependency.
"""
import bpy
import sys
from pathlib import Path

source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source / 'Business_Male_01_facial.fbx'))
names = {'Bip01 Pelvis': 'Hips', 'Bip01 Spine': 'Spine', 'Bip01 Spine1': 'Spine1',
         'Bip01 Spine2': 'Spine2', 'Bip01 Neck': 'Neck', 'Bip01 Head': 'Head'}
for prefix, side in [('L', 'Left'), ('R', 'Right')]:
    for original, target in [('Clavicle', 'Shoulder'), ('UpperArm', 'Arm'),
                             ('Forearm', 'ForeArm'), ('Hand', 'Hand'),
                             ('Thigh', 'UpLeg'), ('Calf', 'Leg'), ('Foot', 'Foot'), ('Toe0', 'ToeBase')]:
        names[f'Bip01 {prefix} {original}'] = side + target
    for finger, digit in enumerate(['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']):
        for joint, suffix in enumerate(['', '1', '2'], 1):
            names[f'Bip01 {prefix} Finger{finger}{suffix}'] = f'{side}Hand{digit}{joint}'
visemes = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U']
expressions = ['BrowDownLeft', 'BrowDownRight', 'BrowInnerUp', 'EyeBlinkLeft',
               'EyeBlinkRight', 'MouthSmileLeft', 'MouthSmileRight']
for obj in bpy.context.scene.objects:
    if obj.animation_data:
        obj.animation_data_clear()
    if obj.type == 'ARMATURE':
        for bone in obj.data.bones:
            if bone.name in names:
                bone.name = names[bone.name]
    if obj.type != 'MESH':
        continue
    for group in obj.vertex_groups:
        if group.name in names:
            group.name = names[group.name]
    keys = obj.data.shape_keys
    if keys:
        if keys.animation_data:
            keys.animation_data_clear()
        for key in list(keys.key_blocks)[1:]:
            if key.name.startswith('AA_VI_'):
                index = int(key.name.split('_')[2])
                key.name = 'viseme_' + visemes[index]
            elif key.name.startswith('AK_') and key.name.split('_', 2)[2] in expressions:
                raw = key.name.split('_', 2)[2]
                key.name = raw[0].lower() + raw[1:]
            else:
                obj.shape_key_remove(key)
                continue
            key.value = 0
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
# Explicit non-metallic materials: the FBX's legacy specular map imports as metallic=1.
for material in bpy.data.materials:
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    shader = tree.nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Roughness'].default_value = 0.82
    out = tree.nodes.new('ShaderNodeOutputMaterial')
    tree.links.new(shader.outputs['BSDF'], out.inputs['Surface'])
    kind = 'head' if 'head' in material.name else 'body'
    is_hair = 'opacity' in material.name
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(source / ('opacity.png' if is_hair else kind + '.jpg')))
    tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    if is_hair:
        tree.links.new(texture.outputs['Alpha'], shader.inputs['Alpha'])
        material.surface_render_method = 'DITHERED'
    material.use_backface_culling = False
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB',
                          export_animations=False, export_morph=True,
                          export_morph_normal=False, export_morph_tangent=False,
                          export_extras=False, export_yup=True)
print('EXPORTED', output, output.stat().st_size)
