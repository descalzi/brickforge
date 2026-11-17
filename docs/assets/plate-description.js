// A small, fully consumed grammar for dimensioned mounting plates. A description
// outside this grammar is left for a model or the specification editor.
const numbers=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
const colours={black:0,blue:1,green:2,red:4,grey:7,gray:7,yellow:14,white:15,tan:19,orange:25};
const unsupported=()=>new Error('Describe a rectangular plate in studs, with optional square through-holes and side walls. For other shapes, choose a model or edit the specification.');
const size=(width,depth,height)=>({width,depth,height});
const position=(x,y,z)=>({x,y,z});

function holePositions(count,width,depth){
  const maxColumns=Math.floor((width-1)/2),maxRows=Math.floor((depth-1)/2);
  if(count>maxColumns*maxRows)throw new Error('The plate needs more studs to leave a one-stud border and material between its openings.');
  const layouts=[];
  for(let rows=1;rows<=Math.min(count,maxRows);rows++){
    const cols=Math.ceil(count/rows);
    if(cols<=maxColumns)layouts.push({rows,score:Math.abs(Math.log(cols/rows)-Math.log(width/depth))+(cols*rows-count)/count});
  }
  const {rows}=layouts.sort((a,b)=>a.score-b.score)[0];
  const coordinate=(index,n,span)=>n===1?Math.floor((span-1)/2):1+Math.round(index*(span-3)/(n-1));
  const points=[];
  for(let row=0;row<rows;row++){
    const cols=Math.floor(count/rows)+(row<count%rows?1:0);
    for(let col=0;col<cols;col++)points.push([coordinate(col,cols,width),coordinate(row,rows,depth)]);
  }
  return points;
}

export function interpretPlate(description){
  let source=description.trim().toLowerCase().replace(/[.!]$/,'').replace(/\s+/g,' ')
    .replace(/^please /,'').replace(/^(?:make|build|design|create|generate) /,'').replace(/^(?:me )?(?:a |an )?/,'')
    .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,word=>String(numbers.indexOf(word)));
  const match=source.match(/^(?:(black|blue|green|red|grey|gray|yellow|white|tan|orange) )?(?:(\d+)\s*(?:x|×|by)\s*(\d+)(?:[- ]stud(?:s)?)? )?(?:rectangular |base )?plate\b/);
  if(!match)throw unsupported();
  source=source.slice(match[0].length).trim();
  let holes=null,walls=null,wallHeight=null,layers=null;
  for(const clause of source.replace(/^(?:,\s*|with )/,'').split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s+with\s+/).filter(Boolean)){
    let m;
    if((m=clause.match(/^(\d+) (?:square )?(?:through[- ]?)?(?:holes?|openings?)$/)) && holes===null)holes=+m[1];
    else if((m=clause.match(/^(?:(\d+) |both )?side walls?(?: (\d+) bricks? (?:high|tall))?$/)) && walls===null){walls=m[1]?+m[1]:2;wallHeight=m[2]?+m[2]:null;}
    else if((m=clause.match(/^(\d+) plate layers?(?: thick)?$/)) && layers===null)layers=+m[1];
    else throw unsupported();
  }
  const width=match[2]?+match[2]:8,depth=match[3]?+match[3]:6;
  if(width<2||depth<2||width>24||depth>24)throw new Error('Choose plate dimensions from 2 to 24 studs per side.');
  holes??=0;walls??=0;
  if(holes>12 || walls>2 || (wallHeight!==null&&(wallHeight<1||wallHeight>6)) || (layers!==null&&(layers<1||layers>4)))throw new Error('Use up to 12 openings, one or two side walls up to six bricks high, and one to four plate layers.');
  const assumptions=[];
  if(!match[2])assumptions.push('The plate is 8 by 6 studs.');
  if(layers===null){layers=2;assumptions.push('The base is '+layers+(layers===1?' plate layer.':' plate layers for interlocking around the openings.'));}
  if(holes)assumptions.push('Each through-opening is one stud square, with a one-stud minimum border and spacing.');
  if(walls)assumptions.push('Side walls run the depth of the plate, one stud thick.'+(wallHeight===null?' Each is one brick high.':''));
  const height=+(layers*3.2).toFixed(6),colour=colours[match[1]]??7;
  const components=[{id:'base',role:'base',geometry:'rectangular_prism',priority:'essential',dimensions_mm:size(width*8,depth*8,height),position_mm:position(0,0,0),colour}];
  const relationships=[];
  for(let i=0;i<walls;i++){
    const id=(i?'right':'left')+'-wall';
    components.push({id,role:'wall',geometry:'rectangular_prism',priority:'essential',dimensions_mm:size(8,depth*8,+((wallHeight??1)*9.6).toFixed(6)),position_mm:position(i?(width-1)*8:0,height,0),colour});
    relationships.push({type:'attached_to',from:id,to:'base'});
  }
  return {schema_version:1,design_id:'plate-'+width+'x'+depth+'-'+holes+'-openings',name:'Mounting plate',units:'mm',components,relationships,
    negative_spaces:(holes?holePositions(holes,width,depth):[]).map(([x,z],i)=>({id:'opening-'+(i+1),position_mm:position(x*8,0,z*8),dimensions_mm:size(8,8,height)})),
    constraints:{require_connected:true,allow_intersections:false,course_type:'auto',max_parts:250,max_search_nodes:100000},assumptions};
}
