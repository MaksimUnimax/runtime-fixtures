import type {QueryStore} from './store-pages';
export function initialQueryStores(stores:QueryStore[],requested:string):string[]{
  if(requested)return stores.some(store=>store.id===requested)?[requested]:[];
  return stores[0]?[stores[0].id]:[];
}
