export type QueryStore={id:string;name:string;provider:string};
type ListedStore=QueryStore&{status:string;identity_verified:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function queryStores(items:ListedStore[]):QueryStore[]{
  return items.filter(s=>s.status==='ACTIVE'&&s.identity_verified)
    .map(s=>({id:s.id,name:s.name,provider:s.provider}));
}

export function storePage(value:unknown):{stores:QueryStore[];cursor:string|null}{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('STORE_PAGE_INVALID');
  const page=value as {items?:unknown;next_cursor?:unknown};
  if(!Array.isArray(page.items)||page.items.length>50||
      !(page.next_cursor===null||typeof page.next_cursor==='string'&&
        page.next_cursor.length>0&&page.next_cursor.length<=1024))throw new Error('STORE_PAGE_INVALID');
  const seen=new Set<string>();
  for(const item of page.items){
    if(!item||typeof item!=='object'||Array.isArray(item)||
        typeof item.id!=='string'||!uuid.test(item.id)||seen.has(item.id)||
        typeof item.name!=='string'||!item.name.length||item.name.length>80||
        typeof item.provider!=='string'||!item.provider.length||item.provider.length>40||
        typeof item.status!=='string'||typeof item.identity_verified!=='boolean')throw new Error('STORE_PAGE_INVALID');
    seen.add(item.id);
  }
  return {stores:queryStores(page.items as ListedStore[]),cursor:page.next_cursor as string|null};
}

export function appendStores(previous:QueryStore[],incoming:QueryStore[]):QueryStore[]{
  const combined=new Map(previous.map(store=>[store.id,store]));
  for(const store of incoming)combined.set(store.id,store);
  return [...combined.values()];
}
