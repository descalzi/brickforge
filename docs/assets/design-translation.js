export function translateComponentRequirements(component,mapping){
 if(!component||typeof component!=="object"||!mapping||mapping.schema_version!==1||!mapping.roles||!mapping.features)throw new TypeError("A component and version-1 design translation map are required.");
 const errors=[],warnings=[];
 const partRoles=mapping.roles[String(component.role||'').toLowerCase()];
 if(!Array.isArray(partRoles)||!partRoles.length)errors.push("No part-role translation exists for semantic role "+component.role+".");
 const requiredCapabilities=[],forbiddenCapabilities=[];
 for(const feature of component.required_features||[]){
  const entry=mapping.features[String(feature).toLowerCase()];
  if(!entry)errors.push("No catalogue translation exists for required design feature "+feature+".");
  else requiredCapabilities.push(...(entry.required_capabilities||[]));
 }
 for(const feature of component.forbidden_features||[]){
  const entry=mapping.features[feature];
  if(!entry)errors.push("No catalogue translation exists for forbidden design feature "+feature+".");
  else forbiddenCapabilities.push(...(entry.required_capabilities||[]));
 }
 return {valid:errors.length===0,errors,warnings,part_roles:partRoles||[],required_capabilities:[...new Set(requiredCapabilities)],forbidden_capabilities:[...new Set(forbiddenCapabilities)]};
}
