const rules=[{a:'stud',b:'stud_receiver',type:'stud_receiver',opposing:true},{a:'wheel_pin',b:'wheel_bore',type:'wheel_pin_bore',opposing:true,fitKey:true},{a:'rim_seat',b:'tyre_seat',type:'rim_tyre_seat',opposing:false,fitKey:true}];
export function featureCompatibility(a,b){const rule=rules.find(r=>(a.kind===r.a&&b.kind===r.b)||(a.kind===r.b&&b.kind===r.a));if(!rule||rule.fitKey&&(!a.fit_key||a.fit_key!==b.fit_key))return null;return rule;}
export function axesCompatible(a,b,rule){const d=a.reduce((s,v,i)=>s+v*b[i],0);return rule.opposing?d<=-.999999:Math.abs(d)>=.999999;}
