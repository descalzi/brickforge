export function validateDesignTranslationMap(mapping){
 const errors=[];
 if(!mapping||mapping.schema_version!==1||typeof mapping.description!=="string"||!mapping.roles||!mapping.features)return {valid:false,errors:["A version-1 design translation map with roles and features is required."]};
 for(const [role,partRoles] of Object.entries(mapping.roles))if(!role.trim()||!Array.isArray(partRoles)||!partRoles.length||partRoles.some(value=>typeof value!=="string"||!value.trim()))errors.push("Invalid part-role mapping for "+role+".");
 for(const [feature,entry] of Object.entries(mapping.features)){
  if(!feature.trim()||!entry||typeof entry!=="object")errors.push("Invalid feature mapping for "+feature+".");
  else for(const key of ["required_capabilities","forbidden_capabilities"])if(entry[key]!==undefined&&(!Array.isArray(entry[key])||entry[key].some(value=>typeof value!=="string"||!value.trim())))errors.push("Invalid "+key+" for feature "+feature+".");
 }
 return {valid:errors.length===0,errors};
}

export function translateComponentRequirements(component,mapping){
 if(!component||typeof component!=="object")throw new TypeError("A design component is required.");
 const validation=validateDesignTranslationMap(mapping);
 if(!validation.valid)throw new TypeError("Invalid design translation map: "+validation.errors.join(" "));
 const errors=[],warnings=[];
 const partRoles=mapping.roles[String(component.role||"").toLowerCase()];
 if(!Array.isArray(partRoles)||!partRoles.length)errors.push("No part-role translation exists for semantic role "+component.role+".");
 const requiredCapabilities=[],forbiddenCapabilities=[];
 for(const feature of component.required_features||[]){
  const entry=mapping.features[String(feature).toLowerCase()];
  if(!entry)errors.push("No catalogue translation exists for required design feature "+feature+".");
  else requiredCapabilities.push(...(entry.required_capabilities||[]));
 }
 for(const feature of component.forbidden_features||[]){
  const entry=mapping.features[String(feature).toLowerCase()];
  if(!entry)errors.push("No catalogue translation exists for forbidden design feature "+feature+".");
  else forbiddenCapabilities.push(...(entry.required_capabilities||[]),...(entry.forbidden_capabilities||[]));
 }
 return {valid:errors.length===0,errors,warnings,part_roles:partRoles||[],required_capabilities:[...new Set(requiredCapabilities)],forbidden_capabilities:[...new Set(forbiddenCapabilities)]};
}
