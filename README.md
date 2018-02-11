ikc_t500
======

Библиотека для работы с терминалом первичного учета IKC-T500

Пример
======

```
  // создание экземпляра 
  var ikc_t500 = require('ikc_t500');

  // задаем уровень логгирования (по-умолчанию 'debug'), поддерживаются уровни: error, warn, info, verbose, debug, silly
  ikc_t500.debuglevel = 'info';

  // открытие порта 
  ikc_t500.open(название порта, [скорость обмена (опционально, по умолчанию 38400)]);
  
```

Встроенные типы данных:
======

ikc_t500.GoodsInfo:Object - Информация о товаре 

------
  - numInBase                   // uint16 – порядковый номер товара в базе
  - price                       // uint32 – цена товара
  - numGoodsGroup               // uint8 – номер товарной группы
  - attrTaxGroup                // налоговая группа
  - attrWeightOrPiece           // весовой (1) / штучный (0)
  - attrControlGoodsExists      // контролировать наличие товара
  - attrBlockSaleNotAvailable   // блокировать продажу, если товара нет в наличии
  - attrNumPaymentName          // номер наименования операции выплаты
  - goodsPresent                // наличие товара (наверное количество?)
  - code                        // код товара Int64 (JavaScript не поддерживает 64-разрядное целое, для работы с ними используется модуль node-biginteger) 
  - name                        // название товара (длина строки до 25 символов)


Методы:
======


ikc_t500.decodeError(errCode: Number): String - Получение текстового описания ошибки 
------
- errCode: Number Код ошибки
- Результат: String Текстовое описание ошибки


ikc_t500.writeGoodsByNum(goodsInfo: ikc_t500.GoodsInfo, cbFun: Function) - Запись товара по номеру в базе 
------
- goodsInfo: ikc_t500.GoodsInfo Информация о товаре
- cbFun: Function(errcode) callback-функция, в параметрах функции передается результат выполнения  

```
  var goodsInfo = new ikc_t500.GoodsInfo({
    numInBase: 1,
    price: 600,
    numGoodsGroup: 1,
    attrTaxGroup: 1,
    attrNumPaymentName: 1,
    goodsPresent: 1,
    code: '1152921504606846975',
    name: 'название товара'
  });

  ikc_t500.writeGoodsByNum(goodsInfo, function(errCode){
    // обработка результата
  });

```


ikc_t500.getZReport(reportNum: Number, cbFun: Function) - Получение данных о Z-отчете по номеру
------
- reportNum: Number - Номер Z-отчета
- cbFun: Function(errCode: Number, result: Object) - callback-функция

result: Object = {
  reportDate: Date,           // время отчёта; 
  countReqTaxBet: Number,     // количество записей налоговых ставок; 
  countChequeSale: Number,    // количество чеков продаж; 
  countChequePay: Number,     // количество чеков выплат; 
  sumSaleByTagGroup: Array(5),// суммы продаж по налоговым группам;
  sumPayByTaxGroup: Array(5) // суммы выплат или НДС по налоговым группам.
}


ikc_t500.writeGoodsByCode(goodsInfo: ikc_t500.GoodsInfo, cbFun: Function) - Запись товара по коду
------
- goodsInfo: ikc_t500.GoodsInfo Информация о товаре
- cbFun: Function(errcode) callback-функция, в параметрах функции передается код ошибки  


ikc_t500.getHourXReport(hour: Number, cbFun: Function) - Получение данных суточного X-отчета по номеру часа (0..23) 
------
- hour: Number - Номер часа (0..23)
- cbFun: Function(errCode: Number, result: Object) - callback-функция

result: Object = {
  countChequeSale: Number - количество чеков продаж
  countChequePay: Number - количество чеков выплат
  sumSale: Int64 - сумма продаж
  sumPay: Int64 - сумма выплат
}


ikc_t500.readEJournalParams(cbFun: Function) - Чтение параметров электронных журналов
------
- cbFun: Function(errcode: Number, result: Array) callback-функция, в параметрах функции передается код ошибки и результат выполнения   

result: Array of Object {
  sessionNum: Number          // номер смены
  sessionDate: Date           // время открытия смены
  numJournalInSession: Number // номер журнала в смена
  lenTextPart: Number         // длина текстовой части журнала
  lenNumberPart: Number       // длина числовой части журнала
}


ikc_t500.clearGoodsBase(onlyBad: Boolean, cbFun: Function) - Очистить базу товаров
------
- onlyBad: Boolean - удалять только "сбойные" записи
- cbFun: Function(errcode) callback-функция, в параметрах функции передается код ошибки  


ikc_t500.readEJournal = function(journalNum, readMode, cbFun) - чтение электронного журнала 
------
- journalNum: Number - номер журнала (0..6)
- readMode: Number - режим чтения (1-текстовый, 2-бинарный)
- cbFun: Function(errcode: Number, result: Array of Object) callback-функция, в параметрах функции передается код ошибки и результат выполнения
         result[i] = {
           chequeNum: Number - номер чека
           format: Number - 1-текстовый, 2-бинарный
           body: Array
            - для текстового чека: массив строк
            - для бинарного чека: массив товаров {goodsCode: Int64 - код товара, goodsCount: Number - количество, goodsPrice: Number - цена}

           // только для бинарного чека
           chequeType: Number - тип чека: 0 - продажа, 1 – выплата, 2 – приём товара, 3 – возврат товара 
           date: Date - время
           kassir: Number - номер кассира(1..8), или 0 - администратор
           count: Number - количество наименований товаров(0..200)
           flag: Number - флаги: бит 0 - есть оплата наличными (1); бит 1 - есть оплата КРТ (1); бит 2 - есть оплата КРД (1); бит 3 - есть номер дисконтной карты (1);
           cash: Number - оплата наличными
           KRT: Number - оплата КРТ
           KRD: Number - оплата КРД
           discountCard: Int64 - номер дисконтной карты 
         }  


Обработчики запросов терминала (должны быть реализованы в хосте):
======


ikc_t500.onGetDiscountParams(num, sum, callback) - Запрос параметров дисконтной карты
------
- num: Int64 - номер дисконтной карты
- sum: Number - сумма чека или стоимость последней продажи (в копейках)
- callback: Function(error:Number - <код завершения>, result: Object = {skidka:<ставка скидки в % * 100>, desc:<описание, строка текста>} 

```
ikc_t500.onGetDiscountParams = function(num, sum, callback) {
  if(callback){
    // симулирую деятельность
    setTimeout(function(){
      callback(0, {skidka:10, desc:'демо скидка'} );
    }, 3000);
    return true;
  }
  else return false;  
}
```


ikc_t500.onGetGoodsDescription = function(goodsCode, callback) - Запрос описания товара
------
- goodsCode:Int64 - код товара
- callback: Function(errCode: Number, goodsInfo: ikc_t500.GoodsInfo) - в параметрах код ошибки и описание товара
