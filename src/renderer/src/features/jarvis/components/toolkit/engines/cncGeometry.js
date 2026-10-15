/** Planar centre paths and a capsule sweep over cell-centred stock. Units: mm. */
export function planarPath({pocket,path,width,height,toolRadius,stepover}) {
  const w=width/2-toolRadius-1,h=height/2-toolRadius-1,points=[];
  if(w<=0||h<=0)throw new Error('The cutter must fit inside the stock with a 1 mm wall.');
  if(pocket==='circle') {
    const r=Math.min(w,h);
    if(path==='spiral') {
      const turns=Math.ceil(r/stepover),count=turns*72;
      for(let i=0;i<=count;i++){const u=i/count,theta=2*Math.PI*turns*u;points.push([r*u*Math.cos(theta),r*u*Math.sin(theta)]);}
    } else if(path==='contour') {
      for(let radius=r;radius>0;radius-=stepover) for(let i=0;i<=72;i++){const theta=2*Math.PI*i/72;points.push([radius*Math.cos(theta),radius*Math.sin(theta)]);}
      points.push([0,0]);
    } else {
      const count=Math.ceil(2*r/stepover);
      for(let i=0;i<=count;i++){const y=-r+2*r*i/count,x=Math.sqrt(Math.max(0,r*r-y*y));points.push(i%2? [x,y]:[-x,y],i%2?[-x,y]:[x,y]);}
    }
  } else if(path==='contour') {
    for(let offset=0;offset<Math.min(w,h);offset+=stepover){const x=w-offset,y=h-offset;points.push([-x,-y],[x,-y],[x,y],[-x,y],[-x,-y]);}
    points.push([0,0]);
  } else {
    const count=Math.ceil(2*h/stepover);
    for(let i=0;i<=count;i++){const y=-h+2*h*i/count;points.push(i%2?[w,y]:[-w,y],i%2?[-w,y]:[w,y]);}
  }
  return points;
}

export function sweepSegment(height,a,b,{cols,rows,stock,radius,ball}) {
  const dx=stock.width/cols,dy=stock.height/rows,r2=radius*radius;
  const vx=b[0]-a[0],vy=b[1]-a[1],len2=vx*vx+vy*vy;
  const ix0=Math.max(0,Math.floor((Math.min(a[0],b[0])-radius+stock.width/2)/dx));
  const ix1=Math.min(cols-1,Math.floor((Math.max(a[0],b[0])+radius+stock.width/2)/dx));
  const iy0=Math.max(0,Math.floor((Math.min(a[1],b[1])-radius+stock.height/2)/dy));
  const iy1=Math.min(rows-1,Math.floor((Math.max(a[1],b[1])+radius+stock.height/2)/dy));
  let removed=0;
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
    const x=(ix+0.5)*dx-stock.width/2,y=(iy+0.5)*dy-stock.height/2;
    const t=len2?Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/len2)):1;
    const distance2=(x-a[0]-vx*t)**2+(y-a[1]-vy*t)**2;
    if(distance2>r2)continue;
    const z=stock.thickness+a[2]+(b[2]-a[2])*t;
    const surface=Math.max(0,z+(ball?radius-Math.sqrt(Math.max(0,r2-distance2)):0));
    const index=iy*cols+ix;
    if(surface<height[index]){removed+=(height[index]-surface)*dx*dy;height[index]=surface;}
  }
  return removed;
}