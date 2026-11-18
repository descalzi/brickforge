// The browser owns model availability, downloads, inference and session disposal.
const languageOptions={
  expectedInputs:[{type:'text',languages:['en']}],
  expectedOutputs:[{type:'text',languages:['en']}]
};

export async function deviceModelState(model=globalThis.LanguageModel) {
  if(!model?.availability || !model.create)return 'unavailable';
  try{return await model.availability(languageOptions);}
  catch{return 'unavailable';}
}

// Restrict generated JSON to the same field names, types and enums as the full
// contract. The normal design validator also enforces conditional geometry rules.
function outputShape(schema,root=schema){
  if(schema.$ref)return outputShape(root.$defs[schema.$ref.split('/').at(-1)],root);
  const shape={};
  for(const key of ['type','enum','const','required','additionalProperties','minItems','maxItems']){
    if(Object.hasOwn(schema,key))shape[key]=schema[key];
  }
  if(schema.enum && !schema.type)shape.type=typeof schema.enum[0];
  if(schema.properties)shape.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,outputShape(value,root)]));
  if(schema.items)shape.items=outputShape(schema.items,root);
  return shape;
}

export function deviceProvider(model=globalThis.LanguageModel,onProgress=()=>{}) {
  return async(request,{signal}={})=>{
    if(!model?.create)throw new Error('This browser has no on-device language model.');
    signal?.throwIfAborted();
    const session=await model.create({...languageOptions,signal,
      initialPrompts:[{role:'system',content:request.instructions}],
      monitor(monitor){monitor.addEventListener('downloadprogress',e=>onProgress(Math.round(e.loaded*100)));}
    });
    try {
      signal?.throwIfAborted();
      onProgress(null);
      const text=await session.prompt(request.input,{responseConstraint:outputShape(request.response_schema),signal});
      if(typeof text!=='string'||text.length>131072)throw new Error('The on-device response exceeds the supported brief size.');
      try{return JSON.parse(text);}
      catch{throw new Error('The on-device model returned invalid JSON. Edit the description and try again.');}
    } finally {session.destroy();}
  };
}

/** A gateway you run: receives the interpretation request, returns the intent JSON. */
export function endpointProvider(address,fetcher=fetch){
 let url;try{url=new URL(address);}catch{throw new Error('Enter the full interpretation gateway URL.');}
 if(url.username||url.password||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Use an HTTPS gateway, or HTTP on localhost, without credentials or a fragment in its URL.');
 return async(request,{signal}={})=>{
  const response=await fetcher(url.href,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)].filter(Boolean))});
  if(!response.ok)throw new Error('Interpretation gateway returned HTTP '+response.status+'.');
  return response.json();
 };
}
