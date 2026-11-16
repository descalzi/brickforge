const finiteVector = value => Array.isArray(value) && value.length===3 && value.every(Number.isFinite);
const dot = (a,b) => a.reduce((sum,value,index)=>sum+value*b[index],0);
const norm = value => Math.hypot(...value);
const normalize = value => {const length=norm(value);return length>1e-9?value.map(item=>item/length):null;};
const transform = (matrix,vector) => [
 matrix[0]*vector[0]+matrix[1]*vector[1]+matrix[2]*vector[2],
 matrix[3]*vector[0]+matrix[4]*vector[1]+matrix[5]*vector[2],
 matrix[6]*vector[0]+matrix[7]*vector[1]+matrix[8]*vector[2]
];
function worldInterface(iface,placement){
 if(!iface||typeof iface.interface_type!=="string"||!finiteVector(iface.position_mm)||!finiteVector(iface.axis_vector))return null;
 const matrix=placement?.matrix||[1,0,0,0,1,0,0,0,1],translation=placement?.translation_mm||[0,0,0];
 if(!finiteVector(matrix.slice(0,3))||!Array.isArray(matrix)||matrix.length!==9||!finiteVector(translation))return null;
 const axis=normalize(transform(matrix,iface.axis_vector));
 if(!axis)return null;
 const position=transform(matrix,iface.position_mm).map((value,index)=>value+translation[index]);
 return {...iface,position_world_mm:position,axis_world:axis};
}

/**
 * Match a male interface to a female interface using source/catalogue evidence.
 * This reports geometric compatibility only; it never asserts physical clutch.
 */
export function matchConnectorInterfaces(male,female,rules,options={}){
 if(!male||!female||!Array.isArray(rules))throw new TypeError("Male interface, female interface and compatibility rules are required.");
 const tolerance=options.centerOffsetToleranceMm;
 const m=worldInterface(male.interface,male.placement),f=worldInterface(female.interface,female.placement);
 if(!m||!f)return {compatible:false,status:"invalid_interface_geometry",reason:"Connector position, axis or placement transform is invalid."};
 const rule=rules.find(item=>item.male_type===m.interface_type&&item.female_type===f.interface_type);
 if(!rule)return {compatible:false,status:"incompatible_interface_types",reason:"No compatibility rule exists for "+m.interface_type+" to "+f.interface_type+"."};
 const offset=Math.hypot(...m.position_world_mm.map((value,index)=>value-f.position_world_mm[index]));
 const alignment=Math.abs(dot(m.axis_world,f.axis_world));
 const allowedOffset=Number.isFinite(tolerance)?tolerance:rule.max_center_offset_mm;
 if(offset>allowedOffset)return {compatible:false,status:"interface_position_mismatch",reason:"Connector axes are offset by "+offset.toFixed(3)+" mm.",centre_offset_mm:offset,rule_id:rule.id};
 if(alignment<rule.min_axis_alignment_cosine)return {compatible:false,status:"interface_axis_mismatch",reason:"Connector axes are not sufficiently aligned.",axis_alignment_cosine:alignment,rule_id:rule.id};
 let diameterDelta=null;
 if(rule.require_diameter){
  if(!Number.isFinite(m.nominal_diameter_mm)||!Number.isFinite(f.nominal_diameter_mm))return {compatible:false,status:"interface_diameter_unknown",reason:"The compatibility rule requires nominal diameters for both interfaces.",rule_id:rule.id};
  diameterDelta=Math.abs(m.nominal_diameter_mm-f.nominal_diameter_mm);
  if(diameterDelta>rule.max_diameter_delta_mm)return {compatible:false,status:"interface_diameter_mismatch",reason:"Nominal diameter difference exceeds the compatibility tolerance.",diameter_delta_mm:diameterDelta,rule_id:rule.id};
 }
 return {compatible:true,status:"nominal_geometry_compatible",rule_id:rule.id,centre_offset_mm:offset,axis_alignment_cosine:alignment,diameter_delta_mm:diameterDelta,evidence_status:rule.evidence_status,physical_connection_verified:false,limitations:[rule.notes||"Nominal interface geometry only; physical connection is not verified."]};
}

export function matchAssemblyConnectors(interfaces,rules,placementsByInstance={}){
 if(!Array.isArray(interfaces)||!Array.isArray(rules))throw new TypeError("Interface and rule arrays are required.");
 const matches=[];
 for(let i=0;i<interfaces.length;i++)for(let j=0;j<interfaces.length;j++){
  if(i===j)continue;
  const a=interfaces[i],b=interfaces[j];
  if(a.instance_id===b.instance_id)continue;
  const result=matchConnectorInterfaces(
   {interface:a,placement:placementsByInstance[a.instance_id]},
   {interface:b,placement:placementsByInstance[b.instance_id]},rules
  );
  if(result.compatible)matches.push({instance_male:a.instance_id,interface_male:a.interface_id,instance_female:b.instance_id,interface_female:b.interface_id,...result});
 }
 const seen=new Set(),unique=[];
 for(const match of matches){const key=[match.instance_male,match.interface_male,match.instance_female,match.interface_female].join("|");if(seen.has(key))continue;seen.add(key);unique.push(match);}
 return unique;
}

/** Convert the source-derived Technic catalogue interfaces into assembly instances. */
export function nominalInterfacesForInstances(catalogue,instances){
 if(!catalogue||catalogue.schema_version!==1||!Array.isArray(catalogue.profiles)||!Array.isArray(instances))throw new TypeError("A version-1 specialised part catalogue and instance list are required.");
 const profiles=new Map(catalogue.profiles.map(profile=>[profile.part_id,profile]));
 const interfaces=[];
 for(const instance of instances){
  const profile=profiles.get(instance.part_id);
  if(!profile)continue;
  for(const iface of profile.nominal_connection_interfaces||[]){
   if(!finiteVector(iface.centre_mm)||!finiteVector(iface.axis_vector))continue;
   interfaces.push({
    instance_id:instance.instance_id,part_id:instance.part_id,interface_id:iface.interface_id,
    interface_type:iface.interface_type,position_mm:iface.centre_mm,axis_vector:iface.axis_vector,
    nominal_diameter_mm:iface.nominal_diameter_mm,evidence_status:iface.status,
    source_file:profile.source_file,source_revision:profile.source_revision
   });
  }
 }
 return interfaces;
}

/** Convert semantic part-catalogue interface datums into positioned assembly instances. */
export function interfacesForPartInstances(catalogue,instances){
 if(!catalogue||catalogue.schema_version!==1||!Array.isArray(catalogue.parts)||!Array.isArray(instances))throw new TypeError("A version-1 part capability catalogue and instance list are required.");
 const parts=new Map(catalogue.parts.map(part=>[part.part_id,part]));
 const interfaces=[];
 for(const instance of instances){
  const part=parts.get(instance.part_id);
  if(!part)continue;
  for(const iface of part.interfaces||[]){
   if(!finiteVector(iface.position_mm)||!finiteVector(iface.axis_vector))continue;
   interfaces.push({...iface,instance_id:instance.instance_id,part_id:instance.part_id});
  }
 }
 return interfaces;
}
