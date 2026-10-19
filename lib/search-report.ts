const money=(n:any)=>n==null?'—':Number(n).toLocaleString('bg-BG')+' €'
const qty=(n:any,unit='')=>n==null||n===''?'—':String(n)+unit
const value=(v:any)=>v==null||v===''?'—':String(v)
const links=(arr:any)=>Array.isArray(arr)&&arr.length?arr.join(', '):'—'
const safeUrl=(u:any)=>typeof u==='string'&&/^https:\/\/[^\s]+$/i.test(u)?u:null

export async function downloadBuyerPdf(buyer:any,criteria:any,offers:any[],searchDate?:string){
  // Load the PDF renderer on demand. Its Roboto font set contains Cyrillic glyphs.
  const pdfModule:any=await import('pdfmake/build/pdfmake')
  const fontModule:any=await import('pdfmake/build/vfs_fonts')
  const pdfMake:any=pdfModule.default||pdfModule
  const fonts:any=fontModule.default||fontModule
  if(typeof pdfMake.addVirtualFileSystem==='function')pdfMake.addVirtualFileSystem(fonts)
  else pdfMake.vfs=fonts.pdfMake?.vfs||fonts

  const date=searchDate?new Date(searchDate):new Date()
  const reportDate=date.toLocaleString('bg-BG')
  const lines:any[]=[
    {text:'ЯВЛЕНА MATCH',style:'brand'},
    {text:'СПРАВКА ОТ ТЪРСЕНЕ НА ИМОТИ',style:'title'},
    {text:'Изготвена: '+reportDate,style:'muted',margin:[0,0,0,15]},
    {text:'ДАННИ ЗА КУПУВАЧА',style:'section'},
    {text:'Име: '+value(buyer?.full_name)},
    {text:'Телефон: '+value(buyer?.phone)},
    {text:'Имейл: '+value(buyer?.email)},
    {text:'Бележки: '+value(buyer?.notes),margin:[0,0,0,9]},
    {text:'КРИТЕРИИ НА ТЪРСЕНЕ',style:'section'},
    {text:'Сделка: '+(criteria?.deal_type==='rent'?'Наем':'Покупка')},
    {text:'Вид имот: '+links(criteria?.property_types)},
    {text:'Райони: '+links(criteria?.districts)},
    {text:'Цена: '+money(criteria?.price_min)+' – '+money(criteria?.price_max)},
    {text:'Площ: '+qty(criteria?.area_min,' кв.м')+' – '+qty(criteria?.area_max,' кв.м')},
    {text:'Спални (мин.): '+qty(criteria?.bedrooms_min)+'  |  Етаж: '+qty(criteria?.floor_min)+' – '+qty(criteria?.floor_max)},
    {text:'Строителство: '+links(criteria?.construction_types)+'  |  След година: '+qty(criteria?.year_min)},
    {text:'Акт 16: '+value(criteria?.act16_level)+'  |  Асансьор: '+value(criteria?.elevator_level)+'  |  Паркиране: '+value(criteria?.parking_level)},
    {text:'Допълнителни изисквания: '+value(criteria?.free_text),margin:[0,0,0,12]},
    {text:'НАМЕРЕНИ ОФЕРТИ: '+offers.length,style:'section'},
    {text:'Линковете са кликаеми. Типът подател е по наличната информация и не винаги е независимо потвърден.',style:'muted',margin:[0,0,0,12]}
  ]
  const grouped=new Map<string,any[]>()
  for(const row of offers){
    const source=row?.offers?.offer_sources?.name||'Неуточнен източник'
    const list=grouped.get(source)||[]
    list.push(row);grouped.set(source,list)
  }
  for(const [source,rows] of grouped){
    lines.push({text:source+' ('+rows.length+')',style:'source',margin:[0,13,0,7]})
    for(let i=0;i<rows.length;i++){
      const o=rows[i]?.offers||{}
      const type=o.advertiser_type==='private'?'Частно лице':o.advertiser_type==='agency'?'Агенция':'Неуточнен подател'
      const url=safeUrl(o.original_url)
      lines.push({text:(i+1)+'. '+value(o.title),style:'offerTitle',margin:[0,9,0,3]})
      lines.push({text:[
        'Район: '+value(o.district)+'   |   Цена: '+money(o.price_eur)+'   |   Площ: '+qty(o.area_sqm,' кв.м')+'\n',
        'Тип: '+value(o.property_type)+'   |   Строителство: '+value(o.construction_type)+'   |   Етаж: '+qty(o.floor)+'\n',
        'Подател: '+type+(o.advertiser_name?' – '+o.advertiser_name:'')+'\n',
        'Контакт: '+value(o.contact_phone)+'   |   Публикувана: '+(o.source_published_at?new Date(o.source_published_at).toLocaleDateString('bg-BG'):'—')
      ],style:'offerMeta'})
      if(url)lines.push({text:'Отвори оригиналната обява: '+url,link:url,style:'link',margin:[0,4,0,5]})
      else lines.push({text:'Оригинален линк: няма',style:'muted'})
    }
  }
  if(!offers.length)lines.push({text:'За това търсене няма намерени оферти.',style:'muted'})
  const doc:any={
    pageSize:'A4',pageMargins:[39,48,39,45],
    info:{title:'Справка за купувач – '+value(buyer?.full_name),author:'Явлена Match',subject:'Справка от търсене на имоти'},
    defaultStyle:{font:'Roboto',fontSize:9,color:'#1b3024',lineHeight:1.23},
    styles:{
      brand:{fontSize:11,bold:true,color:'#176b45',characterSpacing:2},
      title:{fontSize:17,bold:true,color:'#152019',margin:[0,5,0,4]},
      section:{fontSize:10,bold:true,color:'#176b45',margin:[0,8,0,5]},
      source:{fontSize:12,bold:true,color:'#176b45'},
      offerTitle:{fontSize:10,bold:true},
      offerMeta:{fontSize:8.6,color:'#47584a'},
      link:{fontSize:8,color:'#175bbb',decoration:'underline'},
      muted:{fontSize:8,color:'#6d786f'}
    },
    content:lines,
    footer:(current:number,total:number)=>({text:'Явлена Match  •  '+current+' / '+total,alignment:'right',margin:[0,12,40,0],fontSize:8,color:'#7a8980'})
  }
  const filename='Yavlena_Match_'+String(buyer?.full_name||'kupuvach').replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,55)+'_'+date.toISOString().slice(0,10)+'.pdf'
  pdfMake.createPdf(doc).download(filename)
}
