export type CanvasContextMenuTarget={kind:'canvas'}|{kind:'node';shapeId:string};
export function resolveContextSelection(targetId:string,selectedIds:readonly string[]){return selectedIds.includes(targetId)?[...selectedIds]:[targetId];}
export function expandCanvasSelection(ids:readonly string[],shapes:readonly {id:string;parentId?:string}[]){
  const available=new Set(shapes.map(shape=>shape.id));
  const result=new Set(ids.filter(id=>available.has(id)));
  let changed=true;
  while(changed){changed=false;for(const shape of shapes)if(shape.parentId&&result.has(shape.parentId)&&!result.has(shape.id)){result.add(shape.id);changed=true;}}
  return [...result];
}
