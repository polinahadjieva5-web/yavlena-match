// Durable on this browser/device. No customer data is sent to third-party storage.
export type SavedSearch={
  id:string; user_id:string; buyer_id:string; started_at:string; completed_at?:string;
  status:'running'|'completed'|'partial'; buyer:any; criteria:any;
  offers:any[]; source_errors?:Record<string,string>
}
const DB_NAME='yavlena-match-search-history';
const STORE='runs';
function openDatabase():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined')return reject(new Error('Локалната история не се поддържа от този браузър.'))
    const req=indexedDB.open(DB_NAME,1)
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const st=db.createObjectStore(STORE,{keyPath:'id'});st.createIndex('buyer_id','buyer_id',{unique:false})}}
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error||new Error('Не може да се отвори историята.'))
  })
}
function offerSnapshot(item:any){
  const o=item?.offers||{}
  return {
    id:String(item?.id||o.id||o.original_url||''),
    score:Number(item?.score||100),created_at:item?.created_at||new Date().toISOString(),
    offers:{
      id:o.id||null,title:o.title||null,description:String(o.description||'').slice(0,2500),
      original_url:o.original_url||null,property_type:o.property_type||null,
      deal_type:o.deal_type||null,district:o.district||null,price_eur:o.price_eur??null,
      area_sqm:o.area_sqm??null,floor:o.floor??null,total_floors:o.total_floors??null,
      bedrooms:o.bedrooms??null,construction_type:o.construction_type||null,
      construction_year:o.construction_year??null,has_act16:o.has_act16??null,
      has_elevator:o.has_elevator??null,has_parking:o.has_parking??null,
      advertiser_type:o.advertiser_type||'unknown',advertiser_name:o.advertiser_name||null,
      contact_phone:o.contact_phone||null,source_published_at:o.source_published_at||null,
      offer_sources:{name:o.offer_sources?.name||'Неуточнен източник'}
    }
  }
}
function offerKey(row:any){
  const o=row.offers||{}
  return String(o.offer_sources?.name||'').toLowerCase()+'|'+String(o.original_url||o.id||row.id||'')
}
export async function saveSearchRun(run:SavedSearch):Promise<void>{
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite')
    tx.objectStore(STORE).put({...run,offers:(run.offers||[]).map(offerSnapshot)})
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error||new Error('Не може да се запази търсенето.'))}
  })
}
export async function appendSearchOffers(id:string,rows:any[]):Promise<void>{
  if(!rows.length)return
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite')
    const store=tx.objectStore(STORE)
    const get=store.get(id)
    get.onsuccess=()=>{
      const saved=get.result as SavedSearch|undefined
      if(!saved)return
      const mapped=new Map((saved.offers||[]).map((r:any)=>[offerKey(r),r]))
      for(const row of rows){
        const snapshot=offerSnapshot(row)
        mapped.set(offerKey(snapshot),snapshot)
      }
      saved.offers=[...mapped.values()]
      store.put(saved)
    }
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error||new Error('Не може да се допълни историята.'))}
  })
}
export async function completeSearchRun(id:string,status:'completed'|'partial',errors:Record<string,string>={}):Promise<void>{
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite')
    const store=tx.objectStore(STORE)
    const req=store.get(id)
    req.onsuccess=()=>{const run=req.result as SavedSearch|undefined;if(run)store.put({...run,status,completed_at:new Date().toISOString(),source_errors:errors})}
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error||new Error('Не може да се завърши историята.'))}
  })
}
export async function listBuyerSearches(userId:string,buyerId:string):Promise<SavedSearch[]>{
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly')
    const req=tx.objectStore(STORE).index('buyer_id').getAll(buyerId)
    req.onsuccess=()=>resolve(((req.result||[]) as SavedSearch[]).filter(x=>x.user_id===userId).sort((a,b)=>b.started_at.localeCompare(a.started_at)))
    req.onerror=()=>reject(req.error||new Error('Не може да се прочете историята.'))
    tx.oncomplete=()=>db.close()
  })
}

export async function deleteBuyerSearches(userId:string,buyerId:string):Promise<void>{
  const db=await openDatabase()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite')
    const store=tx.objectStore(STORE)
    const req=store.index('buyer_id').getAll(buyerId)
    req.onsuccess=()=>{for(const r of (req.result||[]) as SavedSearch[])if(r.user_id===userId)store.delete(r.id)}
    tx.oncomplete=()=>{db.close();resolve()}
    tx.onerror=()=>{db.close();reject(tx.error||new Error('Не може да се изтрие локалната история.'))}
  })
}
