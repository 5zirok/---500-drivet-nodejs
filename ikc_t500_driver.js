'use strict';

// таймаут ответа ЗАПРОС - ОТВЕТ 100..2000
// задержка перед повтором команды при приёме ответа «ЗАНЯТ» 20..800
// задержка перед началом передачи пакета «ЗАПРОС» после принятия чужого пакета «ЗАПРОС» 20..2000
// Количество попыток связи 2..16

// а) принятый пакет игнорируется:
// +  1. при принятии нераспознанного пакета:
//      + 1. пакет с полем данных более 600 байт
//      + 2. пакет с ошибочной контрольной суммой
//      + 3. с интервалом между байтами превышающим TB (200mc)
// +  2. при принятии пакета «ЗАПРОС», адресованного другому абоненту
// +  3. при принятии пакета «ЗАПРОС» во время выполнения предыдущей команды до передачи пакета «ОТВЕТ»
// +  4. при принятии пакета «ЗАПРОС» с новым кодом команды или от другого абонента во время выполнения предыдущей команды

// + б) время, в течение которого терминал должен передать пакет «ОТВЕТ» после принятия пакета «ЗАПРОС» со стороны ПК, равно 10..2000
// + в) время, в течение которого ПК должен передать пакет «ОТВЕТ» после принятия пакета «ЗАПРОС» со стороны терминала, равно 100..2000
// + д) если абонент не выполнил команду до истечения времени передачи пакета «ОТВЕТ», то он обязан выдать пакет «ОТВЕТ» с кодом завершения «ЗАНЯТ»
//    + при запросе запоминать номер запроса и вешать setTimeout, если хост успевает обработать запрос, то в калбеке очистит номер и пошлет ответ сам 
//    + запоминать последний ответ, на случай, если терминал запросит еще раз (мы уже можем переписать текущий таск)
// + е) если принят пакет «ОТВЕТ» с кодом завершения «ЗАНЯТ», то должен быть повторно передан пакет «ЗАПРОС» (для получения результата выполнения команды или
//    очередного пакета «ОТВЕТ» с кодом завершения «ЗАНЯТ»). Повторный запрос может осуществляться не ранее 20..800
// + и) повторная передача пакета «ЗАПРОС», при отсутствии пакета «ОТВЕТ» в течение времени 2000, может осуществляться немедленно
// + л) абонент, принявший пакет «ЗАПРОС», адресованный ему, получает преимущественное право на выдачу пакета «ОТВЕТ» в отведённое ему для этого время.
//      + Все остальные абоненты сети могут начать передачу своего пакета «ЗАПРОС» не ранее 2000;


const TEXT_CHEQUE_STRLEN = 31;

const DLE           = 0x10,
      STX           = 2,
      ETX           = 3,
      REQ_FROM      = 0,
      REQ_TO        = 1,
      REQ_NUM       = 2,
      REQ_CMD       = 3;

const INT8  = 1,
      INT16 = 2,
      INT24 = 3,
      INT32 = 4,
      INT64 = 8;
      
const // команды ПК
      //CMD_NEXT                  = 0,
      CMD_GET_TYPE_AND_VER      = 9,    //+ посылаю первым запросом ,чтобы удостовериться что подключен нужный девайс
      CMD_GET_HEADER            = 0x1d,
      CMD_SET_HEADER            = 0x1e,
      CMD_GET_FOOTER            = 0x1f,
      CMD_SET_FOOTER            = 0x20,
      CMD_GET_DEFAULT_DISCOUNT  = 0x2b,
      CMD_GET_GOODS_NAME_LEN    = 0x32,
      CMD_GET_GOODS_BY_CODE     = 0x36,
      CMD_WRITE_GOODS_BY_NUM    = 0x37, // ++ 3. Записать (обновить) товар по порядковому номеру
      CMD_DELETE_GOODS_BY_CODE  = 0x3c,
      CMD_CLEAR_GOODS_BASE      = 0x3d, // ++ 4. Очистить базу товаров
      CMD_GET_SERIAL_NUM        = 0x3e,
      CMD_ZREPORT               = 0x44, // +- 2. Выдать Z-отчёт
      CMD_GET_CHEQUE_ITEM       = 0x4a,
      CMD_SEND_BARCODE          = 0x4c, // принять штрих-код
      CMD_DELETE_CHEQUE         = 0x4b,
      CMD_WRITE_GOODS_BY_CODE_2 = 0x51, // ++ 5. Записать (обновить) товар по коду (вариант 2)
      CMD_HOUR_XREPORT          = 0x57, // ++ 1. Выдать часовой X-отчёт за период
      CMD_GET_CHEQUE_PARAMS     = 0x59,
      CMD_READ_EJOURNAL         = 0x67, // ++ 6. Чтение электронного журнала
      CMD_GET_EJ_PARAMS         = 0x68, // ++ Чтение параметров электронных журналов
      
      // команды терминала
      CMD_GET_ALLOW_PAY         = 0x71, // Запрос разрешения оплаты
      CMD_TERMINATE_REQUEST     = 0x72,
      CMD_GET_ALLOW_SALE        = 0x75, // Запрос разрешения продажи
      CMD_MSG_SALE_REJECT       = 0x76,
      CMD_MGS_ANNULATE_CHEQUE   = 0x77,
      CMD_GET_ALLOW_ZREPORT     = 0x79,
      CMD_GET_DISCONT_PARAMS    = 0x7b, // 7. Запрос параметров дисконтной карты
      CMD_MSG_CLOSE_CHEQUE      = 0x7c, // Сообщение о закрытии чека 
      CMD_GET_GOODS_DESCRIPTION = 0x7a; // 8. Запрос описания товара
  
var ADDR_FROM = 1, ADDR_TO = 2,
    SerialPort = require('serialport').SerialPort,
    BigInt = require('node-biginteger'),
    events = require('events'),
    winston = require('winston'),
    util = require('./util.js'),
    logger = new (winston.Logger)({
      level: 'debug',
      transports: [ 
        new (winston.transports.File)({ 
          filename: './logs/ikc_t500_.log',
          maxFiles: 5,
          maxsize: 0x9fffff, //9Mb
          json: false
        })
      ]}),
    fs = require('fs'),
    logDir = './logs',
    prefix = '',
    initialized = 0,
    goodsNameMaxLength = 20,  // 20..31 - действующее значение считывается при инициализации
    lastIncomingData = 0,     // время последнего принятого пакета (для отслеживания таймаута)
    sendLock = 0,             // временная блокировка запросов при обнаружении "чужих" запросов на линии (только для RS485)
    currentRequest = null,    // входящий запрос
    lastAnswer = null,        // последний ответ (если придет тот же запрос, то можно отвечать сразу)
    queue = [];


//winston.handleExceptions(new winston.transports.File({ filename: 'exception.log' }));

/**
* Добавление в массив элементов другого массива
*/
Array.prototype.extend = function (other_array) {
  other_array.forEach(function(v) {this.push(v);}, this);
  return this;    
};

/**
 * Текущая задача
 */
var currentTask = {
  cmd: -1,
  callback: null,
  timeout: 0,
  sended: 0,
  acmd: []
};

// для переменной currentTask прописываем деструктор (через setter)    
Object.defineProperty(
  currentTask, 'item',
  {
    set: function(value){
      if(this.callback){
        // типа деструктор
        logger.warn(prefix+'[currenttask] lost command: %s', this.cmd);
        this.callback({state: -4});
      }
      this.cmd = value.acmd[3];
      this.callback = value.callback;
      this.acmd = value.acmd;
      this.timeout = value.timeout || 2000;
      this.sended = 0;
      this.sendCount = value.sendCount || 3;  // количество повторов
    }}
);    

// создаем каталог для логов
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

// уровни логгирования винстона
// { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }

var ikc_t500 = module.exports = Object.create(events.EventEmitter.prototype);

ikc_t500.MODEL = 'undef';

// информация о товаре
ikc_t500.GoodsInfo = function(params){
  params = params || {};
  this.numInBase = params.numInBase || 0;           // uint16 – порядковый номер товара в базе
  this.price = params.price || 0;                   // uint32 – цена товара
  this.numGoodsGroup = params.numGoodsGroup || 0;   // uint8 – номер товарной группы
  this.attrTaxGroup = params.attrTaxGroup || 0;             // налоговая группа
  this.attrWeightOrPiece = params.attrWeightOrPiece || 0;   // весовой (1) / штучный (0)
  this.attrControlGoodsExists = params.attrControlGoodsExists || 1; // контролировать наличие товара
  this.attrBlockSaleNotAvailable = params.attrBlockSaleNotAvailable || 0; // блокировать продажу, если товара нет в наличии
  this.attrNumPaymentName = params.attrNumPaymentName || 0; // номер наименования операции выплаты
  this.goodsPresent = params.goodsPresent || 0;     // наличие товара (наверное количество?)
  this.code = params.code || 0;                     // код товара Int64
  this.name = params.name || 'безымянный товар';    // название товара

  // аттрибуты товара собираются из нескольких параметров
  this.goodsAttr = function(){
    return this.attrTaxGroup | 
          (this.attrWeightOrPiece ? 0x8 : 0) | 
          (this.attrControlGoodsExists ? 0x10 : 0) | 
          (this.attrBlockSaleNotAvailable ? 0x20 : 0) | 
          ((this.attrNumPaymentName & 3) << 6);
  };
};


Object.defineProperty(
  ikc_t500, 'debuglevel',
  {
    set: function(value){
      if(logger.level !== value){
        logger.log(logger.level, 'debuglevel changed "%s" => "%s"', logger.level, value);  
        logger.level = value;
      }
    }
  });

logger.info(prefix+'*** module ikc_t500 started ***');

var port = null,      // экземпляр СОМ-порта
    active = false,   // порт открыт
    timer = null,     // идентификатор таймера
    inBuff = [],      // буфер входящих данных
    unMaskedBuf = [], // последний принятый ответ
    cmdNum = 1;       // уникальный номер команды
    
ikc_t500.isOpen = function(){
  return active && port && port.isOpen();
};

ikc_t500.close = function(){
  logger.info(prefix+'try close...');  
  if(timer){
    clearInterval( timer );
    timer = null;
  }
  if(port && port.isOpen()){
    port.close();
    active = false;
  }
};

ikc_t500.confirmCloseCheque = function(cbFun){
  if(cbFun){
    logger.info(prefix+'посылаю сообщение о закрытии чека...');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, 0x7c]);

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0) logger.info(prefix+ 'confirmCloseCheque OK: %s', JSON.stringify(o.result));
      else logger.info(prefix+ 'confirmCloseCheque error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
    return true;
  }
  return false;
};


/**
 * Принять штрих-код
 * 
 * @param {String} barcode штрих-код
 * @param {Function} cbFun callback-функция
 * @return {Boolean}
 */
ikc_t500.sendBarCode = function(barcode, cbFun){
  logger.info(prefix+'посылаю штрих-код %s...', barcode);

  var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_SEND_BARCODE]).
              extend( util.convToTerminal(barcode) );

  queue.push( {acmd: cmd, callback: function(o){
    if(o.state===0) logger.info(prefix+ 'sendBarCode OK: %s', JSON.stringify(o.result));
    else logger.info(prefix+ 'sendBarCode error: %s', ikc_t500.decodeError(o.state));
    if(cbFun) cbFun(o.state);
  }});
  return true;
};


/**
 * Считать строку заголовка
 * @param {Number} number номер строки (0-4)
 * @param {Function} cbFun(state, {attr,string}) callback-функция (аттрибут = 0-нормальный/1-высокий/2-широкий)
 */
ikc_t500.getHeaderString = function(number, cbFun){
  var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_HEADER]).
            extend( util.uintXXA(number, INT8) );

  queue.push( {acmd: cmd, callback: function(o){
    let res = {};
    if(o.state===0){
      logger.info(prefix+ 'getHeaderString OK: %s', JSON.stringify(o.result));
      let shift = {value:5}; // from to num cmd errCode

      res.attr = util.array2uintXX(o.result, shift, INT8);
      res.string = util.convToUTF8(o.result, shift);
    }
    else logger.info(prefix+ 'getHeaderString error: %s', ikc_t500.decodeError(o.state));

    cbFun(o.state, res);
  }});
};

/**
 * Записать строку заголовка
 * @param {Number} number   номер строки (0-4)
 * @param {Number} attr     аттрибут = 0-нормальный/1-высокий/2-широкий
 * @param {String} string   записываемая строка
 * @param {Function} cbFun  callback-функция
 */
ikc_t500.setHeaderString = function(number, attr, string, cbFun){
  var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_SET_HEADER]).
            extend( util.uintXXA(number, INT8) ).
            extend( util.uintXXA(attr, INT8) ).
            extend( util.convToTerminal(string) );

  queue.push( {acmd: cmd, callback: function(o){
    if(o.state===0) logger.info(prefix+ 'setHeaderString OK: %s', JSON.stringify(o.result));
    else logger.info(prefix+ 'setHeaderString error: %s', ikc_t500.decodeError(o.state));

    cbFun(o.state);
  }});
};

/**
 * Считать строку подвала
 * @param {Number} number номер строки (0-2)
 * @param {Function} cbFun(state, {attr,string}) callback-функция (аттрибут = 0-нормальный/1-высокий/2-широкий)
 */
ikc_t500.getFooterString = function(number, cbFun){
  var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_FOOTER]).
            extend( util.uintXXA(number, INT8) );

  queue.push( {acmd: cmd, callback: function(o){
    let res = {};
    if(o.state===0){
      logger.info(prefix+ 'getFooterString OK: %s', JSON.stringify(o.result));
      let shift = {value:5}; // from to num cmd errCode

      res.attr = util.array2uintXX(o.result, shift, INT8);
      res.string = util.convToUTF8(o.result, shift);
    }
    else logger.info(prefix+ 'getFooterString error: %s', ikc_t500.decodeError(o.state));

    cbFun(o.state, res);
  }});
};

/**
 * Записать строку подвала
 * @param {Number} number   номер строки (0-2)
 * @param {Number} attr     аттрибут = 0-нормальный/1-высокий/2-широкий
 * @param {String} string   записываемая строка
 * @param {Function} cbFun  callback-функция
 */
ikc_t500.setFooterString = function(number, attr, string, cbFun){
  var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_SET_FOOTER]).
            extend( util.uintXXA(number, INT8) ).
            extend( util.uintXXA(attr, INT8) ).
            extend( util.convToTerminal(string) );

  queue.push( {acmd: cmd, callback: function(o){
    if(o.state===0) logger.info(prefix+ 'setFooterString OK: %s', JSON.stringify(o.result));
    else logger.info(prefix+ 'setFooterString error: %s', ikc_t500.decodeError(o.state));

    cbFun(o.state);
  }});
};

/**
 * Удаляет чек из журнала
 * 
 * @param {Number} chequeNum Номер чека
 */
ikc_t500.deleteCheque = function(chequeNum, cbFun){
  if(!cbFun) throw new Error('вторым параметром должна быть callback-функция');

  logger.info(prefix+'удаляю чек %s...', chequeNum);

  var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_DELETE_CHEQUE]).
            extend( util.uintXXA(chequeNum, INT16) );

  queue.push( {acmd: cmd, callback: function(o){
    if(o.state===0) logger.info(prefix+ 'deleteCheque OK: %s', JSON.stringify(o.result));
    else logger.info(prefix+ 'deleteCheque error: %s', ikc_t500.decodeError(o.state));
    cbFun(o.state);
  }});
};

/**
 * Получение скидки "по умолчанию"
 */
ikc_t500.getDefaultDiscount = function(cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю скидки по-умолчанию...');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_DEFAULT_DISCOUNT]);

    queue.push( {acmd: cmd, callback: function(o){
      let res = {};
      if(o.state===0){
        logger.info(prefix+ 'getDefaultDiscount OK: %s', JSON.stringify(o.result));
        var shift = {value:5}; // from to num cmd errCode

        res.skidka = util.array2uintXX(o.result, shift, INT16);
        res.nacenka = util.array2uintXX(o.result, shift, INT16);
        res.skidkaEnabled = util.array2uintXX(o.result, shift, INT8);
        res.nacenkaEnabled = util.array2uintXX(o.result, shift, INT8);
      }
      else logger.info(prefix+ 'getDefaultDiscount error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
    return true;
  }
  return false;
};



/**
 * Выдать товар, проданный в чеке
 * 
 * @param {Number} chequeNum Номер чека
 * @param {Number} itemNum порядковый номер товара в чеке
 */
ikc_t500.getChequeItem = function(chequeNum, itemNum, cbFun){
  if(cbFun){
    logger.info(prefix+'посылаю запрос "Выдать товар (%s), проданный в чеке (%s)"...', itemNum, chequeNum);

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_CHEQUE_ITEM]).
              extend( util.uintXXA(chequeNum, INT16) ).
              extend( util.uintXXA(itemNum, INT16) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0){
        var shift = {value:5}; // from to num cmd errCode

        res.code = util.array2uintXX(o.result, shift, INT64).toString();
        res.count = util.array2uintXX(o.result, shift, INT32);
        res.price = util.array2uintXX(o.result, shift, INT32); 
        res.skidka = util.array2uintXX(o.result, shift, INT32);
        res.nacenka = util.array2uintXX(o.result, shift, INT32);

        logger.info(prefix+ 'getChequeItem OK: %s', JSON.stringify(res));
      }
      else 
        logger.info(prefix+ 'getChequeItem error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});

    return true;
  }
  return false;
};

/**
 * Получить параметры ПЕРВОГО подходящего чека в онлайн-журнале
 * 
 * @param {Number} chequeNum порядковый номер чека
 */
ikc_t500.getCheque = function(chequeNum, cbFun){
  if(cbFun){
    logger.info(prefix+'посылаю запрос "Выдать параметры чека" %s...', chequeNum);

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_CHEQUE_PARAMS]).
              extend( util.uintXXA(chequeNum, INT16) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0){
        var shift = {value:5}; // from to num cmd errCode

        res.chequeNum = util.array2uintXX(o.result, shift, INT16);
        res.chequeType = util.array2uintXX(o.result, shift, INT8);
        res.kassirNum = util.array2uintXX(o.result, shift, INT8); 
        res.goodsCount = util.array2uintXX(o.result, shift, INT8);
        res.payCash = util.array2uintXX(o.result, shift, INT32);
        res.payCard = util.array2uintXX(o.result, shift, INT32);
        res.payKredit = util.array2uintXX(o.result, shift, INT32);
        res.skidka = util.array2uintXX(o.result, shift, INT32);
        res.nacenka = util.array2uintXX(o.result, shift, INT32);
        res.discontNum = util.array2uintXX(o.result, shift, INT64).toString();
        res.closeDate = convertDateTime( util.array2uintXX(o.result, shift, INT32) );

        logger.info(prefix+ 'getCheque OK: %s => %s', JSON.stringify(res), arrayToHex(o.result));
      }
      else 
        logger.info(prefix+ 'getCheque error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
    return true;
  }
  return false;
};

ikc_t500.getAllowPay = function(payForm, price, chequeType, cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю разрешение оплаты...');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, 0x71]).
              extend( util.uintXXA(payForm, INT8) ).
              extend( util.uintXXA(price, INT32) ).
              extend( util.uintXXA(chequeType, INT8) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0) logger.info(prefix+ 'getAllowPay OK: %s', JSON.stringify(o.result));
      else logger.info(prefix+ 'getAllowPay error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
    return true;
  }
  return false;
};

ikc_t500.getAllowSale = function(code, count, price, chequeType, cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю разрешение продажи...');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_ALLOW_SALE]).
              extend( util.uintXXA(code, INT64) ).
              extend( util.uintXXA(count, INT32) ).
              extend( util.uintXXA(price, INT32) ).
              extend( util.uintXXA(chequeType, INT8) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0) logger.info(prefix+ 'getAllowSale OK: %s', JSON.stringify(o.result));
      else logger.info(prefix+ 'getAllowSale error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
    return true;
  }
  return false;
};


/**
 * Запрос описания товара по коду (эмулятор терминала)
 */
ikc_t500.getGoodsDesc = function(code, cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю параметры товара...');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_GOODS_DESCRIPTION]).
              extend( util.uintXXA(code, INT64) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0) logger.info(prefix+ 'getGoodsDesc OK: %s', JSON.stringify(o.result));
      else logger.info(prefix+ 'getGoodsDesc error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
    return true;
  }
  return false;
};

/**
 * Запрос параметров дисконтной карты (эмулятор терминала)
 */
ikc_t500.getDiscountCardParams = function(num, sum, cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю параметры дисконтной карты...');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_DISCONT_PARAMS]).
              extend( util.uintXXA(num, INT64) ).
              extend( util.uintXXA(sum, INT32) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0){
        logger.info(prefix+ 'getDiscountCardParams OK: %s', JSON.stringify(o.result));
      }
      else
        logger.info(prefix+ 'getDiscountCardParams error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
  }
};


/**
 * Чтение параметров электронных журналов
 * 
 * @param {Function} cbFun(errCode, array of item) 
 */
ikc_t500.readEJournalParams = function(cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю параметры электронных журналов...');
    queue.push( {acmd: [ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_EJ_PARAMS], callback: function(o){
      var res = [];
      if(o.state===0){
        var shift = {value:5}; // from to num cmd errCode
        var jCount = util.array2uintXX(o.result, shift, INT8);
        logger.debug(prefix+'доступное количество журналов: %s', jCount);

        for(var i=0;i<jCount;i++){
          var item = {
            sessionNum: util.array2uintXX(o.result, shift, INT16), // номер смены
            sessionDate: convertDateTime( util.array2uintXX(o.result, shift, INT32) ), // время открытия смены
            numJournalInSession: util.array2uintXX(o.result, shift, INT8), // номер журнала в смена
            lenTextPart: util.array2uintXX(o.result, shift, INT32), // длина текстовой части журнала
            lenNumberPart: util.array2uintXX(o.result, shift, INT32) // длина числовой части журнала
          };
          logger.debug(prefix+'Элемент журнала: %s', JSON.stringify(item));
          res.push(item);
        }
      }
      else
        logger.info(prefix+ 'readEJournalParams error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
  }
};

ikc_t500.getSerialNum = function(cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю серийный номер...');
    queue.push( {acmd: [ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_SERIAL_NUM], callback: function(o){
      var res = '';
      if(o.state===0){
        var shift = {value:5}; // from to num cmd errCode
        res = util.convToUTF8(o.result, shift);
        logger.info(prefix+ 'getSerialNum: %s', res);
      }
      else
        logger.info(prefix+ 'getSerialNum error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
  }
};

/**
 * Разбор блока и запись в массив чеков
 */
function parseBlock(currentBlock, cheques){
  var item = {chequeNum: currentBlock.chequeNum, body: []}, shift = {value:0};
  if(currentBlock.format===1){
    // текстовый формат

    item.format = 1;

    var readed = 0, sArr = [];

    while(readed<currentBlock.chequeLen){
      var ch = util.array2uintXX(currentBlock.buf, shift, INT8) & 0xff;
      readed++;

      if(ch===0){
        if(sArr.length){
          let str = util.convToUTF8(sArr, {value:0});
          logger.debug(prefix+'"'+str+'"');
          item.body.push( str );
          sArr.length = 0;
        }

        for(var i=0;i<TEXT_CHEQUE_STRLEN+1;i++)
          sArr.push( 45 );

        let str = util.convToUTF8(sArr, {value:0});
        logger.debug(prefix+'"'+str+'"');
        item.body.push( str );
        sArr.length = 0;
      }
      if(ch===0x7f){
        sArr.push( 32 ); //судя по чеку - двойная ширина
      }
      else if(ch<32){
        for(let i=0;i<ch;i++){
          sArr.push( 32 );

          if(sArr.length>TEXT_CHEQUE_STRLEN){
            let str = util.convToUTF8(sArr, {value:0});
            logger.debug(prefix+'"'+str+'"');
            item.body.push( str );
            sArr.length = 0;
          }
        }
      }
      else 
        sArr.push( ch );

      if(sArr.length>TEXT_CHEQUE_STRLEN){
        var str = util.convToUTF8(sArr, {value:0});
        logger.debug(prefix+'"'+str+'"');
        item.body.push( str );
        sArr.length = 0;
      }
    } // while

  }
  else {
    // бинарный формат
    item.format = 2;

    item.chequeType = util.array2uintXX(currentBlock.buf, shift, INT8);
    item.date = convertDateTime( util.array2uintXX(currentBlock.buf, shift, INT32) );
    item.kassir = util.array2uintXX(currentBlock.buf, shift, INT8);
    item.count = util.array2uintXX(currentBlock.buf, shift, INT8);
    item.flag = util.array2uintXX(currentBlock.buf, shift, INT8);
    item.cash = (item.flag & 1) ? util.array2uintXX(currentBlock.buf, shift, INT32) : 0; 
    item.KRT = (item.flag & 2) ? util.array2uintXX(currentBlock.buf, shift, INT32) : 0; 
    item.KRD = (item.flag & 4) ? util.array2uintXX(currentBlock.buf, shift, INT32) : 0; 
    item.discountCard = (item.flag & 8) ? util.array2uintXX(currentBlock.buf, shift, INT64) : 0; 
    
    for(let i=0;i<item.count;i++){
      item.body.push({
        goodsCode: util.array2uintXX(currentBlock.buf, shift, INT64),
        goodsCount: util.array2uintXX(currentBlock.buf, shift, INT32),
        goodsPrice: util.array2uintXX(currentBlock.buf, shift, INT32)
      });
    }

    logger.debug(prefix+JSON.stringify(item));
  }

  cheques.push(item);
}


/**
 * Рекурсивно читаю блоки электронного журнала
 * 
 * @param {Number} journalNum Номер электронного журнала (отсчет с 0)
 * @param {Object} currentBlock Параметры текущего блока данных {chequeLen: длина чека, format: 1|2 - текст/бинарный, chequeNum: номер чека, buf: остаток от предыдущего блока}
 * @param {Object} params параметры блока {length: Длина всех чеков, mode: 1|2 - текст/бинарный}
 * @param {Array} cheques Массив чеков (результат)
 */
function readBlock(journalNum, currentBlock, params, cheques){
  return new Promise(function(resolve, reject){
    logger.debug(prefix+'запрашиваю блок %s', currentBlock.blockNum);

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_READ_EJOURNAL]).
              extend( util.uintXXA(currentBlock.blockNum, INT16) ).
              extend( [journalNum, params.mode] );

    queue.push( {acmd: cmd, callback: function(o){
      if(o.state===0){
        currentBlock.blockNum++;

        // разбираем блок
        var shift = {value:5};

        while(shift.value<(o.result.length-1)){
          if(currentBlock.buf.length===0){
            // новый блок - считываем параметры чека

            if( (o.result.length - shift.value - 1) < 6 ){
              logger.debug(prefix+'в блоке осталось меньше чем длина заголовка');
              // копируем данные из блока в буфер
              util.copyArray(o.result, currentBlock.buf, shift, 6);          
              break;
            }

            if(currentBlock.chequeLen<0) currentBlock.chequeLen = util.array2uintXX(o.result, shift, INT24);
            if(currentBlock.format<0) currentBlock.format = util.array2uintXX(o.result, shift, INT8);
            if(currentBlock.chequeNum<0) currentBlock.chequeNum = util.array2uintXX(o.result, shift, INT16);
            logger.debug(prefix+'параметры чека: %s', JSON.stringify(currentBlock));
          }else{
            // если предыдущий блок закончился на заголовке, то считываем заголовок
            if(currentBlock.chequeLen<0){
              var bufShift = {value:0};
              util.copyArray(o.result, currentBlock.buf, shift, 6 - currentBlock.buf.length);
              currentBlock.chequeLen = util.array2uintXX(currentBlock.buf, bufShift, INT24);
              currentBlock.format = util.array2uintXX(currentBlock.buf, bufShift, INT8);
              currentBlock.chequeNum = util.array2uintXX(currentBlock.buf, bufShift, INT16);
              logger.debug(prefix+'параметры чека: %s', JSON.stringify(currentBlock));
              currentBlock.buf.length = 0;
            }
            else
              logger.debug(prefix+'продолжаем чтение чека: chequeLen=%s', currentBlock.chequeLen/*, arrayToHex(currentBlock.buf)*/);
          }

          if(currentBlock.chequeLen === 0xffffff){
            // пустой хвост - все сбрасываем и читаем следующий блок
            logger.debug(prefix+'последний блок, прерываю чтение');
            params.length = 0;
            break;
          }

          // копируем данные из блока в буфер
          util.copyArray(o.result, currentBlock.buf, shift, currentBlock.chequeLen - currentBlock.buf.length);          

          if(currentBlock.buf.length===currentBlock.chequeLen){
            // считали весь буфер - разбираем
            params.length -= currentBlock.chequeLen;

            parseBlock(currentBlock, cheques);

            currentBlock.buf.length = 0;
            currentBlock.chequeLen = -1;
            currentBlock.format = -1;
            currentBlock.chequeNum = -1;
          }
        }

        logger.debug(prefix+'осталось прочитать %s', params.length);

        resolve();
      }
      else if(o.state===162){
        // все прочитали
        params.length=0;
        resolve();
      }
      else {
        logger.warn(prefix+ ikc_t500.decodeError(o.state) );
        reject( o.state );
      }
    }});
  }).then(()=>{
    // рекурсия
    if(params.length>0)
      return readBlock(journalNum, currentBlock, params, cheques);
  });
}

ikc_t500.BlockInfo = function(params){
  params = params || {};
  this.blockNum = params.blockNum || 0;     // считываемый блок (начинаем с 0)
  this.buf = params.buf || [];              // остаток предыдущего блока
  this.chequeLen = params.chequeLen || -1;  // длина текущего чека
  this.format = params.format || -1;        // формат чека
  this.chequeNum = params.chequeNum || -1;  // номер чека
};

/**
 * Чтение электронного журнала с возможностью дочитки
 * 
 * @param {Object} journalObj 
 */
ikc_t500.readEJournalEx = function(journalObj, readMode, cbFun){
  if(cbFun){
    //journalNum = journalNum*1;
    readMode = readMode*1;
    var //cheques = journalObj.cheques, //результат - массив чеков
        currentBlock = journalObj.blockInfo;

    return new Promise(function(resolve, reject){
      logger.debug(prefix+'запрашиваю параметры электронных журналов');
      // сначала считываем параметры журналов (могли измениться с последней проверки)
      ikc_t500.readEJournalParams(function(errCode, data){
        if(errCode===0) {
          // текущий номер журнала меньше общего количества
          if(data.length>journalObj.journalNum){
            if(readMode & 0x1) resolve({mode:1, length: data[journalObj.journalNum].lenTextPart, data:data[journalObj.journalNum]});
            else resolve({mode:2, length: data[journalObj.journalNum].lenNumberPart, data:data[journalObj.journalNum]});
          }
          else reject( -5 );
        }
        else {
          logger.warn(prefix+ ikc_t500.decodeError(errCode) );
          reject( errCode );
        }
      });
    }).then(params=>{
      if(params.length>0){
//
        logger.debug(prefix+'начинаю чтение журнала %s', journalObj.journalNum);
        return readBlock(journalObj.journalNum, currentBlock, params, journalObj.cheques);
      }
    }).then(()=>{
      logger.debug(prefix+'закончил чтение журнала %s', journalObj.journalNum);
      cbFun(0);    
    }, error=>{
      logger.warn(prefix+'ошибка при чтении журнала: %s', ikc_t500.decodeError(error));
      cbFun(error);    
    });
  }  
};

/**
 * Чтение электронного журнала
 * 
 * @param {Number} journalNum номер журнала (0..6)
 * @param {Number} readMode режим чтения
 * @param {Function} cbFun callback-функция, параметры (errCode: Number, aResult: Array of Object)
 */
ikc_t500.readEJournal = function(journalNum, readMode, cbFun){
  if(cbFun){
    journalNum = journalNum*1;
    readMode = readMode*1;
    var cheques = [], //результат - массив чеков
        currentBlock = {
          blockNum:0,   // считываемый блок (начинаем с 0) 
          buf:[],       // остаток предыдущего блока
          chequeLen: -1,  // длина текущего чека
          format: -1,    // формат чека
          chequeNum: -1}; // номер чека
    return new Promise(function(resolve, reject){
      logger.debug(prefix+'запрашиваю параметры электронных журналов');
      // сначала считываем параметры журналов (могли измениться с последней проверки)
      ikc_t500.readEJournalParams(function(errCode, data){
        if(errCode===0) {
          if(data.length>journalNum){
            if(readMode & 0x1) resolve({mode:1, length: data[journalNum].lenTextPart});
            else resolve({mode:2, length: data[journalNum].lenNumberPart});
          }
          else reject( -5 );
        }
        else {
          logger.warn(prefix+ ikc_t500.decodeError(errCode) );
          reject( errCode );
        }
      });
    }).then(params=>{
      if(params.length>0){
        logger.debug(prefix+'начинаю чтение журнала %s', journalNum);
        return readBlock(journalNum, currentBlock, params, cheques);
      }
    }).then(()=>{
      logger.debug(prefix+'закончил чтение журнала %s', journalNum);
      cbFun(0, cheques);    
    }, error=>{
      logger.warn(prefix+'ошибка при чтении журнала: %s', ikc_t500.decodeError(error));
      cbFun(error);    
    });
  }  
};

/**
 * Получение информации о товаре по номеру в базе
 * 
 * @param {Number} num Порядковый номер товара, если товара с таким номером нет, то выдаст следующий
 * @param {Function} cbFun callback(error, [object]) функция 
 */
ikc_t500.getGoodsByNum = function(num, cbFun){
  if(cbFun){
    logger.info(prefix+'запрашиваю товар N %s...', num);
    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, 0x34]).extend( util.uintXXA(num, INT16) );    

    queue.push( {acmd: cmd, callback: function(o){
      let res = {};
      if(o.state===0){
        logger.info(prefix+ 'getGoodsByNum OK: %s', arrayToHex(o.result));

        var shift = {value:5}; // from to num cmd errCode

        res.goodsOrder = util.array2uintXX(o.result, shift, INT16);
        res.price = util.array2uintXX(o.result, shift, INT32);
        res.numGoodsGroup = util.array2uintXX(o.result, shift, INT8);
        res.goodsAttr = util.array2uintXX(o.result, shift, INT8);
        res.goodsPresent = util.array2uintXX(o.result, shift, INT32);
        res.saleCount = util.array2uintXX(o.result, shift, INT32);
        res.payCount = util.array2uintXX(o.result, shift, INT32);
        res.sumSale = util.array2uintXX(o.result, shift, INT32);
        res.sumPay = util.array2uintXX(o.result, shift, INT32);
        res.sumSkidkiOnSale = util.array2uintXX(o.result, shift, INT32);
        res.sumSkidkiOnPay = util.array2uintXX(o.result, shift, INT32);
        res.sumNacenkiOnSale = util.array2uintXX(o.result, shift, INT32);
        res.sumNacenkiOnPay = util.array2uintXX(o.result, shift, INT32);
        res.code = util.array2uintXX(o.result, shift, INT64).toString();
        res.name = util.convToUTF8(o.result, shift);

        logger.debug(prefix+JSON.stringify(res));        
      }
      else {
        logger.info(prefix+ 'getGoodsByNum error: %s', ikc_t500.decodeError(o.state));
      }
      cbFun(o.state, res);
    }});
  }
};

/**
 * Получение информации о товаре по коду
 * 
 * @param {BigInt | String} code Код товара
 */
ikc_t500.getGoodsByCode = function(code, cbFun){
  if(cbFun){
    switch (typeof code) {
      case 'string':
        logger.debug('code: string');
        break;
      case 'number':
        logger.debug('code: number');
        code = code.toString();
        break;
      default:
        if(code instanceof BigInt){
          logger.debug('code: BigInt');
          code = code.toString();
        }
        else{ 
          logger.debug('code: %s'+typeof(code));
          cbFun(-1);
          return false;
        }
    }
    logger.info(prefix+'запрашиваю товар с кодом %s...', code);
    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_GOODS_BY_CODE]).extend( util.uintXXA(code, INT64) );    
    queue.push( {acmd: cmd, callback: function(o){
      var res = {};
      if(o.state===0){
        logger.info(prefix+ 'getGoodsByCode OK: %s', arrayToHex(o.result));

        var shift = {value:5}; // from to num cmd errCode
          
        res.goodsOrder = util.array2uintXX(o.result, shift, INT16);
        res.price = util.array2uintXX(o.result, shift, INT32);
        res.numGoodsGroup = util.array2uintXX(o.result, shift, INT8);
        res.goodsAttr = util.array2uintXX(o.result, shift, INT8);
        res.goodsPresent = util.array2uintXX(o.result, shift, INT32);
        res.saleCount = util.array2uintXX(o.result, shift, INT32);
        res.payCount = util.array2uintXX(o.result, shift, INT32);
        res.sumSale = util.array2uintXX(o.result, shift, INT32);
        res.sumPay = util.array2uintXX(o.result, shift, INT32);
        res.sumSkidkiOnSale = util.array2uintXX(o.result, shift, INT32);
        res.sumSkidkiOnPay = util.array2uintXX(o.result, shift, INT32);
        res.sumNacenkiOnSale = util.array2uintXX(o.result, shift, INT32);
        res.sumNacenkiOnPay = util.array2uintXX(o.result, shift, INT32);

        //var code = 
        util.array2uintXX(o.result, shift, INT64);

        res.code = code; //.toString();
        res.name = util.convToUTF8(o.result, shift);        
      }
      else {
        logger.info(prefix+ 'getGoodsByCode error: %s', ikc_t500.decodeError(o.state));
      }
      cbFun(o.state, res);
    }});
    return true;
  }
  else
    return false;
};


/**
 * Запись товара по номеру в базе, 0x37
 * 
 * @param {GoodsInfo} goodsInfo Информация о товаре
 * @param {Function} cbFun callback-функция с результатом
 */
ikc_t500.writeGoodsByNum = function(goodsInfo, cbFun){
  if(cbFun){
    logger.info(prefix+'try writeGoodsByNum: %s', JSON.stringify(goodsInfo));
    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_WRITE_GOODS_BY_NUM]).
              extend( util.uintXXA(goodsInfo.numInBase, INT16) ).
              extend( util.uintXXA(goodsInfo.price, INT32) ).
              extend( util.uintXXA(goodsInfo.numGoodsGroup, INT8) ).
              extend( util.uintXXA(goodsInfo.goodsAttr(), INT8) ).
              extend( util.uintXXA(goodsInfo.goodsPresent, INT32) ).
              extend( util.uintXXA(goodsInfo.code, INT64) ).
              extend( util.convToTerminal(goodsInfo.name) );

    queue.push( {acmd: cmd, callback: function(o){
      if(o.state===0)
        logger.info(prefix+ 'writeGoodsByNum OK: %s', arrayToHex(o.result));
      else
        logger.info(prefix+ 'writeGoodsByNum error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state);
    }});
  }
};

ikc_t500.writeGoodsByCode = function(goodsInfo, cbFun){
  if(cbFun){
    logger.debug(prefix+'Запись товара по коду (вариант 2): %s', JSON.stringify(goodsInfo));

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_WRITE_GOODS_BY_CODE_2]).
              extend( util.uintXXA(goodsInfo.price, INT32) ).
              extend( util.uintXXA(goodsInfo.numGoodsGroup, INT8) ).
              extend( util.uintXXA(goodsInfo.goodsAttr(), INT8) ).
              extend( util.uintXXA(goodsInfo.goodsPresent, INT32) ).
              extend( util.uintXXA(goodsInfo.code, INT64) ).
              extend( util.convToTerminal(goodsInfo.name) );

    queue.push( {acmd: cmd, callback: function(o){
      if(o.state===0)
        logger.info(prefix+ 'writeGoodsByCode OK: %s', arrayToHex(o.result));
      else
        logger.info(prefix+ 'writeGoodsByCode error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, o.result || null);
    }});
  }
};


var firstJan2001 = Date.UTC(2001, 0); 

/**
 * Преобразует внутреннее представление времени в тип Data
 * 
 * @param {Number} dt Количество секунд с 1 января 2001г
 * @return {Data} 
 */
function convertDateTime(dt){
  return new Date(firstJan2001 + dt*1000);
}

/**
 * Выдать часовой X-отчёт за период
 * 
 * @param {Number} hour Номер часа от 0 до 23
 * @param {Function} cbFun 
 */
ikc_t500.getHourXReport = function(hour, cbFun){
  if(cbFun){
    logger.debug(prefix+'Выдать часовой X-отчёт за период %s...', hour);
    queue.push( {acmd: [ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_HOUR_XREPORT, hour & 0xff], callback: function(o){
      var res = {};
      if(o.state===0){
        var shift = {value:5};
        res.countChequeSale = util.array2uintXX(o.result, shift, INT32);
        res.countChequePay = util.array2uintXX(o.result, shift, INT32);
        res.sumSale = util.array2uintXX(o.result, shift, INT64);
        res.sumPay = util.array2uintXX(o.result, shift, INT64);

        logger.info(prefix+ 'getHourXReport OK: %s', JSON.stringify(res));
      }
      else
        logger.info(prefix+ 'getHourXReport error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
  }
};

/**
 * Удаление товар по коду
 * 
 * @param {String} code код товара (int64)
 */
ikc_t500.deleteGoodsByCode = function(code, cbFun){
  if(cbFun){
    logger.debug(prefix+'пытаюсь удалить товар: %s', code);

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_DELETE_GOODS_BY_CODE]).
              extend( util.uintXXA(code, INT64) );

    queue.push( {acmd: cmd, callback: function(o){
      cbFun(o.state);
    }});
  }
};

/**
 * Очистка базы товаров
 * 
 * @param {Boolean} onlyBad Удалять только сбойные записи
 * @param {Function} cbFun
 */
ikc_t500.clearGoodsBase = function(onlyBad, cbFun){
  if(cbFun){
    logger.debug(prefix+'пытаюсь очистить базу товаров');

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_CLEAR_GOODS_BASE, onlyBad ? 1 : 0]);

    queue.push( {acmd: cmd, callback: function(o){
      cbFun(o.state);
    }});
  }
};

/**
 * Выдача Z-отчета по номеру, 0x44
 * 
 * @param {Number} reportNum номер отчета
 * @param {Function} cbFun  
 */
ikc_t500.getZReport = function(reportNum, cbFun){
  if(cbFun){
    logger.debug(prefix+'try get Z-report N %s...', reportNum);

    var cmd = ([ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_ZREPORT]).
        extend( util.uintXXA(reportNum*1, INT16) );

    queue.push( {acmd: cmd, callback: function(o){
      var res = null;
      if(o.state===0){
        logger.info(prefix+ 'getZReport OK: %s', arrayToHex(o.result));
        var shift = {value:5};
        res = {
          reportDate: convertDateTime( util.array2uintXX(o.result, shift, INT32) ), //uint32 – время отчёта; 
          countReqTaxBet: util.array2uintXX(o.result, shift, INT8), //uint8 – количество записей налоговых ставок; 
          countChequeSale:  util.array2uintXX(o.result, shift, INT16), //uint16 – количество чеков продаж; 
          countChequePay: util.array2uintXX(o.result, shift, INT16), //uint16 – количество чеков выплат; 
          sumSaleByTagGroup: [util.array2uintXX(o.result, shift, INT32), //int32[5] – суммы продаж по налоговым группам;
                              util.array2uintXX(o.result, shift, INT32),
                              util.array2uintXX(o.result, shift, INT32),
                              util.array2uintXX(o.result, shift, INT32),
                              util.array2uintXX(o.result, shift, INT32)],
          sumPayByTaxGroup: [util.array2uintXX(o.result, shift, INT32),
                             util.array2uintXX(o.result, shift, INT32),
                             util.array2uintXX(o.result, shift, INT32),
                             util.array2uintXX(o.result, shift, INT32),
                             util.array2uintXX(o.result, shift, INT32)]//int32[5] – суммы выплат или НДС по налоговым группам.
        };

        logger.debug(prefix+'report time: %s', res.reportDate);
      }
      else
        logger.info(prefix+ 'getZReport error: %s', ikc_t500.decodeError(o.state));
      cbFun(o.state, res);
    }});
  }
};

/**
 * Очищаем callback и код команды, чтобы по таймеру могла запуститься следующая команда
 */
var finalizePacket = function(){
  currentTask.callback = null;
  currentTask.cmd = -1;  
};

/**
 * Разбираем входящий пакет (уже демаскирован и проверено CRC)
 */
var parseAnswer = function(){
  logger.debug(prefix+'< '+arrayToHex(unMaskedBuf));
  
  // фильтруем по адресу получателя
  if(unMaskedBuf[1] === ADDR_FROM){
    logger.debug(prefix+'адресовано нам');
    var cmd = unMaskedBuf[3];
    if((cmd & 0x80)>0){
      logger.debug(prefix+'ответ на запрос');
      
      //ответ на наш запрос
      cmd &= 0x7f;
      if(cmd===currentTask.cmd){
        if(unMaskedBuf[2]===currentTask.acmd[2]){
          logger.debug(prefix+'команда и номер соответствуют запросу');
          // ответ на наш вопрос и совпадает номер пекета
          switch (unMaskedBuf[4]) {
            case 0:
              // успех
              logger.debug(prefix+'запрос выполнен успешно');
              if(currentTask.callback)
                currentTask.callback({state: 0, result: unMaskedBuf});
              finalizePacket();
              break;
            case 254: //ОТКАЗ
            case 255: //ЗАНЯТ
              logger.debug(prefix+'терминал занят');
              // временные состояния - по таймеру отправится повторый запрос
              if(currentTask.sendCount<0){
                logger.debug(prefix+'превышено количество повторных запросов');
                currentTask.callback({state: -2});
                finalizePacket();
              }
              break;
            default:
              logger.debug(prefix+'терминал вернул ошибку запроса');
              if(currentTask.callback)
                currentTask.callback({state: unMaskedBuf[4]});
              finalizePacket();
              break;
          }
        } else {
          logger.warn(prefix+'номер ответа (%s) не соответствует номеру запроса (%s)', unMaskedBuf[2], currentTask.acmd[2]);
        } 
      } else {
        // ответ не соответствует запросу - игнорируем?
        logger.warn(prefix+'ответ (0x%s) не соответствует запросу (0x%s)', cmd.toString(16), currentTask.cmd.toString(16));
      }
    }
    else{
      //запрос терминала
      logger.silly(prefix+'запрос со стороны терминала');
      processTerminalRequest( unMaskedBuf );
    }
  }
  else{
    // a.2 адресовано не нам
    logger.debug(prefix+'адресовано не нам');
    if((unMaskedBuf[3] & 0x80)===0){
      // тип пакета "запрос"
      sendLock = (new Date()).getTime();
    }
    unMaskedBuf.length = 0;
  }
  
  // в обработчиках могли накидать новых заданий в очередь
  checkQueue();
};


ikc_t500.onIdle = null;

/**
 * Сообщение о закрытии чека
 */
ikc_t500.onMsgCloseCheque = null;

/**
 * Запрос разрешения оплаты
 * 
 * @param {Number} payType форма оплаты (0 – наличные, 1 – карта, 2 – кредит)
 * @param {Number} sum сумма
 * @param {Number} chequeType тип чека
 */
ikc_t500.onGetAllowPay = null;

/**
 * Запрос разрешения продажи
 * 
 * @param {Int64} goodsCode код товара
 * @param {Number} goodsCount количество товара
 * @param {Number} goodsPrice цена товара
 * @param {Number} chequeType тип чека
 * @param {Function} callback (errCode: Number, goodsInfo: ikc_t500.GoodsInfo) - в параметрах код ошибки и описание товара
 */
ikc_t500.onGetAllowSale = null;


/**
 * запрос разрешения z-отчета
 */
ikc_t500.onGetAllowZReport = null;

/**
 * Запрос описания товара
 * 
 * @param {Int64} goodsCode код товара
 * @param {Function} callback (errCode: Number, goodsInfo: ikc_t500.GoodsInfo) - в параметрах код ошибки и описание товара
 */
ikc_t500.onGetGoodsDescription = null;

/**
 * Запрос параметров дисконтной карты
 * 
 * @param {Int64} num номер дисконтной карты
 * @param {Number} sum сумма чека или стоимость последней продажи (в копейках)
 * @param {Function} callback {error:<код завершения>, bet:<ставка скидки в % * 100>, desc:<описание, строка текста>} 
 */
ikc_t500.onGetDiscountParams = null;

/**
 * Обработка запросов от терминала
 * 
 * @param {Array} arr входящий запрос
 */
var processTerminalRequest = function(arr){
  try{
    // если запрос от того-же терминала с тем же номером - возвращаем старый ответ
    //if(lastAnswer) logger.debug(prefix+'typeof(lastAnswer): %s %s', typeof(lastAnswer), arrayToHex(lastAnswer));

    if(lastAnswer &&
       (arr[REQ_FROM] === lastAnswer[REQ_TO]) &&
       (arr[REQ_NUM] === lastAnswer[REQ_NUM]) &&
       (arr[REQ_CMD] === (lastAnswer[REQ_CMD] & 0x7f))){
      logger.debug(prefix+'повторный запрос и есть ответ, возвращаем предыдущий ответ');
      sendAnswer(lastAnswer);
      return;
    }

    // a)3..4 - игнорируем запрос во время выполнения предыдыущего ответа

    if( currentRequest &&
        currentRequest.req[REQ_FROM]===arr[REQ_FROM] &&
        currentRequest.req[REQ_NUM]===arr[REQ_NUM] &&
        currentRequest.req[REQ_CMD]===arr[REQ_CMD])
    {
      logger.debug(prefix+'повторный запрос без готового ответа, возвращаем ЗАНЯТ');
      sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 255] );
      return;
    }

    var cmd='';

    switch (arr[3]) {
      case CMD_GET_EJ_PARAMS:
        logger.debug(prefix+'получен запрос параметров электронного журнала');
        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]).
                  extend( [0x6,0x1,0x0,0x85,0x31,0xea,0x1c,0x1,0x48,0x3,0x0,0x0,0xaf,0x0,0x0,
                           0x0,0x1,0x0,0x0,0x0,0x0,0x0,0x1,0x32,0x2f,0x0,0x0,0xb6,0xa,0x0,0x0,
                           0x1,0x0,0x0,0x0,0x0,0x0,0x1,0x77,0x52,0x0,0x0,0x4c,0x12,0x0,0x0,0x1,
                           0x0,0x0,0x0,0x0,0x0,0x1,0xd4,0x21,0x0,0x0,0xd7,0x6,0x0,0x0,0x1,0x0,
                           0x0,0x0,0x0,0x0,0x1,0x57,0x28,0x0,0x0,0xae,0x8,0x0,0x0,0x1,0x0,0x0,
                           0x0,0x0,0x0,0x1,0x9c,0xf,0x0,0x0,0x69,0x3,0x0,0x0] );
        sendAnswer(cmd, true);
        break;
      case CMD_READ_EJOURNAL:
        logger.debug(prefix+'получен запрос чтения электронного журнала');

        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]);

        var blockNum = util.array2uintXX(arr, {value:4}, INT16);

        switch(blockNum){
          case 0:
            cmd.extend( [0xa2,0x0,0x0,0x1,0x1,0x0,0x0,0x32,0x31,0x30,0x35,0x39,0x36,0x1,
                          0x4c,0x55,0x4d,0x41,0x58,0x2f,0x31,0x34,0x30,0x2d,0x30,0x37,0x2f,
                          0x32,0x37,0x30,0x30,0x8,0x19,0x32,0x32,0x2c,0x30,0x30,0x1,0xc0,
                          0x7f,0xd1,0x7f,0xd3,0x7f,0xcc,0x7f,0xc0,0x7f,0xd,0x7f,0x32,0x7f,
                          0x32,0x7f,0x2c,0x7f,0x30,0x7f,0x30,0xc3,0xee,0xf2,0xb3,0xe2,0xea,
                          0xee,0xfe,0x13,0x32,0x32,0x2c,0x30,0x30,0x0,0xca,0xe0,0xf1,0xe8,
                          0xf0,0x1,0xb9,0x1,0x31,0x11,0xce,0xef,0xf2,0xe8,0xea,0xe0,0x4,
                          0x31,0x36,0x2d,0x30,0x35,0x2d,0x32,0x30,0x31,0x36,0x1,0x31,0x36,
                          0x3a,0x34,0x39,0x1,0xf7,0xe5,0xea,0x1,0xb9,0x1,0x31,0x4,0xb,0xcc,
                          0xcf,0x35,0x30,0x30,0x30,0x30,0x31,0x30,0x39] );
            break;
          case 1:
            cmd.extend([0xb,0x6,0xd1,0xef,0xe0,0xf1,0xe8,0xe1,0xee,0x1,0xe7,0xe0,0x1,0xef,
                        0xee,0xea,0xf3,0xef,0xea,0xf3,0x21,0x7,0x8,0xcd,0xc5,0xd4,0xb2,
                        0xd1,0xca,0xc0,0xcb,0xdc,0xcd,0xc8,0xc9,0x1,0xd7,0xc5,0xca,0x8,
//                        0x1d,0x0,0x0,0x0,0x1,0x0,0x0,0x85,0x31,0xea,0x1c,0x1,0x1,0x1,0x98,
                        0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,
                        0x8,0x0,0x0,0x8c,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0xe8,0x3,0x0,0x0,0x98,
                        0x8,0x0,0x0,0x0,0xa2,0x0,0x0,0x1,0x2,0x0,0x0,0x32,0x31,0x30,0x35,
                        0x39,0x36,0x1,0x4c,0x55,0x4d,0x41,0x58,0x2f,0x31,0x34,0x30,0x2d,
                        0x30,0x37,0x2f,0x32,0x37,0x30,0x30,0x8,0x19,0x32,0x32,0x2c,0x30,
                        0x30,0x1,0xc0,0x7f,0xd1,0x7f,0xd3,0x7f,0xcc,0x7f,0xc0,0x7f,0xd,0x7f,
                        0x32,0x7f ]);
            break;
        }


        sendAnswer(cmd, true);
        break;
      case CMD_GET_SERIAL_NUM: //emu
        logger.debug(prefix+'получен запрос серийного номера');

        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]).
                  extend( util.convToTerminal('МП50000109') );

        sendAnswer(cmd, true);
        break;
      case CMD_GET_TYPE_AND_VER:
        logger.debug(prefix+'получен запрос версии терминала');

        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]).
                  extend( util.convToTerminal('эмулятор') );

        sendAnswer(cmd, true);
        break;
      case CMD_GET_GOODS_BY_CODE: // emu
        logger.debug(prefix+'получен запрос свойств товара (по коду)');

        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]).
                  extend( util.uintXXA(1, INT16) ).    // порядковый номер в базе
                  extend( util.uintXXA(50, INT32) ).   // цена товара
                  extend( util.uintXXA(1, INT8) ).     // номер товарной группы
                  extend( util.uintXXA(0, INT8) ).     // атрибуты товара
                  extend( util.uintXXA(1, INT32) ).    // наличие товара
                  extend( util.uintXXA(1, INT32) ).    // количество продаж
                  extend( util.uintXXA(0, INT32) ).    // количество выплат
                  extend( util.uintXXA(50, INT32) ).   // сумма продаж
                  extend( util.uintXXA(0, INT32) ).    // сумма выплат
                  extend( util.uintXXA(0, INT32) ).    // сумма скидок при продажах
                  extend( util.uintXXA(0, INT32) ).
                  extend( util.uintXXA(0, INT32) ).
                  extend( util.uintXXA(0, INT32) ).
                  extend( util.uintXXA('123', INT64) ).// код товара
                  extend( util.convToTerminal('тестовый товар') );

        sendAnswer(cmd, true);
        break;
      case CMD_WRITE_GOODS_BY_NUM:
        logger.debug(prefix+'получен запрос "записать товар по порядковому номеру"');

        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]);

        sendAnswer(cmd, true);
        break;
      case CMD_GET_GOODS_NAME_LEN:
        logger.debug(prefix+'получен запрос длины названия товара');

        cmd = ([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0]).
                  extend( util.uintXXA(25, INT8) ).
                  extend( util.uintXXA(5500, INT16) ).
                  extend( util.uintXXA(4500, INT16) ).
                  extend( util.uintXXA(0, INT16) );

        sendAnswer(cmd, true);
        break;
      case CMD_MSG_CLOSE_CHEQUE:
        if(ikc_t500.onMsgCloseCheque){
          currentRequest = {
            req: ([]).extend(arr),
            time: (new Date()).getTime()
          };
          logger.debug(prefix+'сохранен текущий запрос: %s', JSON.stringify(currentRequest));

          logger.debug(prefix+'поступило сообщение о закрытии чека');

          // сразу возвращаю ОК
          sendAnswer([ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0], true);

          ikc_t500.onMsgCloseCheque(function(){});
        }
        else throw 'хостом не реализована обработка сообщения о закрытии чека (0x7c)';
        break;
      case CMD_GET_ALLOW_PAY: // Запрос разрешения оплаты
        if(ikc_t500.onGetAllowPay){
          currentRequest = {
            req: ([]).extend(arr),
            time: (new Date()).getTime()
          };
          logger.debug(prefix+'сохранен текущий запрос: %s', JSON.stringify(currentRequest));

          var shift = {value:4},
              payType = util.array2uintXX(arr, shift, INT8),
              sum = util.array2uintXX(arr, shift, INT32),
              chequeType = util.array2uintXX(arr, shift, INT8);

          logger.debug(prefix+'запрошено разрешение оплаты: форма оплаты=%s, сумма=%s, тип чека=%s', payType, sum, chequeType);

          sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 255] );

          ikc_t500.onGetAllowPay(payType, sum, chequeType, function(errCode, params){
            var ans = [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, errCode];

            if(errCode===0){
              ans.extend( util.uintXXA(params.action, INT8) ).
                  extend( util.convToTerminal(params.text, 30) ); 
            }

            logger.debug(prefix+'посылаю ответ на запрос разрешения оплаты');
            sendAnswer(ans, true);
          });
        }
        else throw 'хостом не реализована обработка запроса разрешения продажи (0x75)';
        break;
      case CMD_MSG_SALE_REJECT:
      case CMD_TERMINATE_REQUEST:
      case CMD_MGS_ANNULATE_CHEQUE:
        currentRequest = {
          req: ([]).extend(arr),
          time: (new Date()).getTime()
        };
        sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0] );
        break;

      case CMD_GET_ALLOW_ZREPORT:
        currentRequest = {
          req: ([]).extend(arr),
          time: (new Date()).getTime()
        };
        if(ikc_t500.onGetAllowZReport){
          ikc_t500.onGetAllowZReport(function(errCode){
            var ans = [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, errCode];
            logger.debug(prefix+'посылаю ответ на запрос разрешения Z-отчета');
            sendAnswer(ans, true);
          });
        }
        else {
          sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 0] );
        }
        break;
      case CMD_GET_ALLOW_SALE: // Запрос разрешения продажи
        if(ikc_t500.onGetAllowSale){
          currentRequest = {
            req: ([]).extend(arr),
            time: (new Date()).getTime()
          };
          logger.debug(prefix+'сохранен текущий запрос: %s', JSON.stringify(currentRequest));

          let shift = {value:4},
              code = util.array2uintXX(arr, shift, INT64),
              count = util.array2uintXX(arr, shift, INT32),
              price = util.array2uintXX(arr, shift, INT32),
              chequeType = util.array2uintXX(arr, shift, INT8);

          logger.debug(prefix+'запрошено разрешение продажи: код товара=%s, количество=%s, стоимость=%s', code.toString(), count, price);

          sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 255] );

          ikc_t500.onGetAllowSale(code, count, price, chequeType, function(errCode, params){
            var ans = [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, errCode];

            if(errCode===0){
              ans.extend( util.uintXXA(params.action, INT8) ).
                  extend( util.convToTerminal(params.text, 30) ); 
            }

            logger.debug(prefix+'посылаю ответ на запрос разрешения продажи');
            sendAnswer(ans, true);
          });
        }
        else throw 'хостом не реализована обработка запроса разрешения продажи (0x75)';
        break;  
      case CMD_GET_DISCONT_PARAMS: // 7. Запрос параметров дисконтной карты 0x7b
        if(ikc_t500.onGetDiscountParams){
          currentRequest = {
            req: ([]).extend(arr),
            time: (new Date()).getTime()
          };
          logger.debug(prefix+'сохранен текущий запрос: %s', JSON.stringify(currentRequest));

          sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 255] );

          let shift = {value:4},
              num = util.array2uintXX(arr, shift, INT64),
              sum = util.array2uintXX(arr, shift, INT32);

          logger.debug(prefix+'запрошены параметры дисконтной карты: num=%s, sum=%s', num.toString(), sum);

          ikc_t500.onGetDiscountParams(num, sum, function(errCode, params){
            var ans = [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, errCode];

            if(errCode===0){
              ans.extend( util.uintXXA(params.skidka, INT16) ).
                  extend( util.convToTerminal(params.desc, 30) ); 
            }

            logger.debug(prefix+'посылаю ответ на запрос параметров дисконтной карты');
            sendAnswer(ans, true);

          });
        }
        else throw 'хостом не реализована обработка запроса параметров дисконтной карты (0x7B)';
        break;
      case CMD_GET_GOODS_DESCRIPTION: // 8. Запрос описания товара
        if(ikc_t500.onGetGoodsDescription){
          currentRequest = {
            req: ([]).extend(arr),
            time: (new Date()).getTime()
          };

          logger.debug(prefix+'сохранен текущий запрос: %s', JSON.stringify(currentRequest));

          // обязаны что-то ответить в течении 2 сек
          //var timeOut = onAnswerTimeout( arr );
          sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 255] );

          let shift = {value:4},
              goodsId = util.array2uintXX(arr, shift, INT64);

          logger.debug(prefix+'запрошено описание товара id: %s', goodsId.toString());

          //var goodsId = arrayToInt64(arr, 4);

          ikc_t500.onGetGoodsDescription(goodsId, function(errCode, goodsInfo){
            // убираем ответ по таймауту

            var ans = [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, errCode];

            if(errCode===0){
              logger.debug(prefix+'сервер выдал товар: '+JSON.stringify(goodsInfo));

              ans.extend( util.uintXXA(goodsInfo.price*1, INT32) ).
                  extend( [goodsInfo.numGoodsGroup*1] ).
                  extend( [goodsInfo.goodsAttr()] ).
                  extend( util.uintXXA(goodsInfo.goodsPresent*1, INT32) ).
                  extend( util.uintXXA(goodsInfo.code, INT64) ).
                  extend( util.convToTerminal(goodsInfo.name, goodsNameMaxLength) );

              logger.debug(prefix+'подготовлен ответ: '+arrayToHex(ans)); 
            }

            logger.debug(prefix+'посылаю ответ на запрос описания товара');
            sendAnswer(ans, true);
          });
        } 
        else throw 'хостом не реализована обработка запроса описания товара (0x7a)';
        break;
      default:
        // остальным посылаем ошибку "команда не поддерживается"
        throw 'команда не поддерживается';
    }
  }catch(e){
    logger.warn(prefix+e);
    // при любой ошибке шлем ответ "команда не поддерживается"
    sendAnswer( [ADDR_FROM, arr[REQ_FROM], arr[REQ_NUM], arr[REQ_CMD] | 0x80, 88] );
  }
};

/**
 * отправка ответа
 * 
 * @param {Array} arr пакет для отправки
 * @param {Boolean} save запоминать ответ
 */
function sendAnswer(arr, save){
  if(active){
    // разблокируем очередь
    if(currentRequest)
      currentRequest.time = 0;

    // запоминаем последний ответ
    if(save){ 
      lastAnswer = (new Array()).extend(arr);
      logger.debug(prefix+'запоминаю ответ: %s', arrayToHex(lastAnswer));
    }
   
    var buf = [DLE, STX]; //начало пакета

    // считаем CRC одновременно с записью, DLE считается один раз
    var crc = 0;

    //маскируем
    for(var i=0;i<arr.length;i++){
      if(arr[i]===DLE) buf.push(DLE);
      buf.push(arr[i]);
      crc += arr[i];
    }

    // добавляем CRC
    crc = 256-(crc & 0xff);

    if(crc===256) crc = 0;

    buf.push(crc);
    if(crc===0x10) buf.push(DLE);

    // конец пакета
    buf.push(DLE); 
    buf.push(ETX); 
    
    logger.debug(prefix+'> %s', arrayToHex(buf));
    
    var buffer = new ArrayBuffer( buf.length ),
        packet = new Uint8Array( buffer );
        
    // м.2 для RS485 в начале пакета добавляем мусор, чтобы занять линию (для RS232 вроде тоже не должно мешать)
    //packet[0] = 0xff;
        
    for(let i=0;i<buf.length;i++){
      packet[i]=buf[i];
    }

    port.write(buffer);
  }
}

/**
 * Разбираем входящий буфер (данные добавляются побайтно)
 * 
 */
var checkInBuff = function(){
  // <DLE><STX> <AddrT><AddrR><Num><Cmd><Data><CS><DLE><ETX>

  // пакет должен начинаться с DLE+STX - прочий мусор игнорируем
  if(inBuff[0]!==DLE){
    logger.warn('checkInBuff => inBuff[0]!==DLE');
    inBuff.length = 0;
    return;
  } 

  // проверяю второй байт
  if(inBuff.length>1 && inBuff[1]!==STX){
    logger.warn('checkInBuff => inBuff[1]!==STX');
    inBuff.shift();
    // вторым мог попасться DLE - проверяем еще раз
    if(inBuff[0]!==DLE) inBuff.length = 0;
    return; 
  }

  // а.1.1 данных больше 600 байт
  if(inBuff.length>608){
    inBuff.length = 0;
    logger.debug(prefix+'поле данных более 600 байт - очищаю буфер');
    return;
  }
  
  // начало нормальное - ищем конец
  if(inBuff.length>8){
    if(inBuff[inBuff.length-1]===ETX && inBuff[inBuff.length-2]===DLE){
      // конец похож на настоящий - демаскируем данные (убираем двойной DLE и проверяем контрольную сумму)
      var incomingBuf = (new Array()).extend( inBuff ), 
          tempBuff = [];
          
      logger.silly('конец буфера похож на конец пакета - проверяю %s', arrayToHex(incomingBuf));

      //incomingBuf.extend( inBuff );   

      var i=2, mask=false, crc=0, finish = false; 
      // начинаем с 3-го байта (DLE+STX пропускаем)
      while(i<incomingBuf.length){
        //маскирующий DLE сразу пропускаем
        if(incomingBuf[i]===DLE){
          i++;
          mask = true;
        }
        
        if(i<incomingBuf.length){
          if(mask && incomingBuf[i]===ETX){
            // маскированный ETX - конец пакета 
            finish = true;
            break;
          }
          else{
            if(i<incomingBuf.length-3) crc += incomingBuf[i];
            tempBuff.push(incomingBuf[i]);
            mask = false;
          }
        }
        i++;
      }
      
      if(finish){
        logger.silly('действительно конец пакета - проверяю CRC');
        // DLE+ETX в конец не пишутся
        crc = 256 - (crc & 0xff);
        if(crc===256) crc = 0;
        if(crc===tempBuff[tempBuff.length-1]){
          logger.silly(prefix+'CRC OK');
          unMaskedBuf = tempBuff;
          parseAnswer();
          inBuff.length = 0;
          return true;
        }
        else{
          //а.1.2
          logger.warn(prefix+'не верный CRC (%s): %s', crc, arrayToHex(incomingBuf));
          inBuff.length = 0;
        }
      }
      else
        logger.silly('это еще не конец');

      return false;
    } // valid end (ETX+DLE)  
  } //len>8  
};

/**
 * Прием данных СОМ порта
 * 
 * @param {Buffer} data 
 */
var onData = function(data){
  // a.1.3 если в буфере просроченные данные - очищаем (по протоколу 200мс, но системы не "реального времени", да и асинхронность ноды может повлиять)
  if(inBuff.length>0 && lastIncomingData!==0 && getTicks(lastIncomingData)>1000){
    inBuff = [];
    logger.debug(prefix+'просроченные данные - очищаю буфер');
  }
  lastIncomingData = (new Date()).getTime();
  
  var packet = new Uint8Array( data );
  // побайтно дописываем в буфер и проверяем пакет
  for(var i=0;i<packet.length;i++){
    inBuff.push( packet[i] );
    logger.silly(prefix+'< '+packet[i].toString(16));
    // проверяем пакет
    checkInBuff();
  }
};


/**
 * Преобразует массив в HEX строку (для логгирования)
 * 
 * @param {Array} arr Массив байт
 * @return {String}  
 */
var arrayToHex = function(arr){
  var res = '';
  for(var i=0;i<arr.length;i++) res += ' '+arr[i].toString(16);
  return res;
};

// возвращает кол-во миллисекунд прошедшее с указанного запроса
var getTicks = function(lastSend){
  return (new Date()).getTime() - lastSend;  
};

/**
 * Посылка периодических сообщений (проверка связи)
 */
var onTimer = function(){
  //если есть входящий запрос, то ничего не делаем
  if(currentRequest && currentRequest.time>0){
    if(getTicks(currentRequest.time)>2000) currentRequest.time = 0;
    else return;
  }

  // проверяем не выполняется ли в данный момент другая команда
  if(currentTask.cmd>=0){
    var delta = getTicks(currentTask.sended);
    if(currentTask.sended && delta>currentTask.timeout){
      logger.debug(prefix+'таймаут команды: %s (%smsec)', currentTask.cmd, delta); 
      if(currentTask.sendCount>0){
        currentTask.sendCount--;
        sendCurrentTask();
        return;
      }
      else{
        currentTask.callback( {state: -1} );
        finalizePacket();
      }
    }
    else return;
  }
  
  if(ADDR_FROM === 1){
    // очередь пуста и еще не было ответа на запрос модели терминала
    if(queue.length===0 && (initialized & 1)===0){
      //запрос типа и версии терминала
      logger.info(prefix+'Запрашиваю тип и версию терминала...');
      queue.push( {acmd: [ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_TYPE_AND_VER], callback: function(o){
        if(o.state===0){
          logger.info(prefix+'responce: '+arrayToHex(o.result) );
          initialized |= 1;
          var shift = {value:5};

          var sTerminalVer = util.convToUTF8(o.result, shift);
          logger.info(prefix+'версия терминала: %s', sTerminalVer);
        
          if(!(sTerminalVer.substr(0,4)==='ІКС-' || sTerminalVer.substr(0,8)==='эмулятор')){
            logger.error('не поддерживаемая модель терминала, деактивирую порт');
            active = false;
          }
          else
            ikc_t500.MODEL = sTerminalVer.substr(4,4);
        } else {
          logger.info(prefix+'ошибка при запросе версии терминала: %s, %s', o.state, ikc_t500.decodeError(o.state) );
        }
      }} );
    }
    
    if(queue.length===0 && (initialized & 2)===0){
      // Выдать длину названия товара и количество товаров
      logger.info(prefix+'Запрашиваю длину названия товара и количество товаров...');
      queue.push( {acmd: [ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, CMD_GET_GOODS_NAME_LEN], callback: function(o){
        if(o.state===0){
          logger.info(prefix+'responce: '+arrayToHex(o.result) );
          initialized |= 2;

          var shift = {value:5};

          goodsNameMaxLength = util.array2uintXX(o.result, shift, INT8);
          logger.info(prefix+'длина названия товара: %s', goodsNameMaxLength);
          logger.info(prefix+'максимальное количество товаров в базе: %s', util.array2uintXX(o.result, shift, INT16));
          logger.info(prefix+'количество запрограммированных товаров, включая сбойные записи: %s', util.array2uintXX(o.result, shift, INT16));
          //uint16 – количество сбойных записей.


          //ikc_t500.readEJournal(0, 1, function(){});
          
        } else {
          logger.info(prefix+'ошибка при запросе длины названия товара: %s, %s', o.state, ikc_t500.decodeError(o.state) );
        }
      }} );
    }
  }

  logger.silly(prefix+'queue length on timer: %s', queue.length);
  
  checkQueue();

  // ничем не занят
  if(ikc_t500.onIdle && queue.length===0 && currentTask.cmd===-1){
    let dd = (new Date()).getTime();
    if((dd-lastIncomingData)>2000) ikc_t500.onIdle();
  }
};

/**
 * если есть задания в очереди - отправляем
 */
var checkQueue = function(){
  // л) есть активность "на линии" - ничего не отправляем  
  if(sendLock!==0){
    if(getTicks(sendLock)<2000) return;
    else sendLock = 0;
  } 

  if(currentTask.cmd<0 && queue.length>0){
    currentTask.item = queue.shift();
    sendCurrentTask();
  }
};

/**
 * Отправка текущей команды в СОМ-порт
 */
var sendCurrentTask = function(){
  if(active){
    currentTask.sended = (new Date()).getTime();
    
    var buf = [DLE, STX]; //начало пакета

    // считаем CRC одновременно с записью, DLE считается один раз
    var crc = 0;

    //маскируем
    for(var i=0;i<currentTask.acmd.length;i++){
      if(currentTask.acmd[i]===DLE) buf.push(DLE);
      buf.push(currentTask.acmd[i]);
      crc += currentTask.acmd[i];
    }

    // добавляем CRC
    crc = 256-(crc & 0xff);

    buf.push(crc);
    if(crc===0x10) buf.push(DLE); 

    // конец пакета
    buf.push(DLE); 
    buf.push(ETX); 
    
    logger.debug(prefix+'> %s', arrayToHex(buf));
    
    var buffer = new ArrayBuffer( buf.length ),
        packet = new Uint8Array( buffer );
        
    // м.2 для RS485 в начале пакета добавляем мусор, чтобы занять линию (для RS232 вроде тоже не должно мешать)
    //packet[0] = 0xff;
        
    for(let i=0;i<buf.length;i++) packet[i]=buf[i];
    port.write(buffer);
  }
  else if(currentTask.callback){
    // обмен заблокирован (порт закрыт или железо не то)    
    currentTask.callback({state: -3});
  }  
};


/**
 * Открыть порт и начать обмен данными
 * 
 * @param {String} aPortName Имя СОМ-порта
 * @param {Number} aBaudRate Скорость соединения (по-умолчанию 38400)
 */
ikc_t500.open = function(aPortName, aBaudRate, emulator, callback){
  emulator = emulator || false;

  //режим эмулятора
  if(emulator){
    prefix = '[emu] ';
    logger.info(prefix+'запущен в режиме эмулятора');
    ADDR_FROM = 2;
    ADDR_TO = 1;
  }

  var baudRate = aBaudRate || 38400;
  port = new SerialPort(aPortName, {'baudRate': baudRate}, false);

  try{
    port.open(function(error){
      if(error){
        logger.error('error on open port %s: %s', aPortName, error);
        if(callback) callback(-1, error);
      } else {
        active = true;
        logger.info(prefix+'open port %s OK, baudrate = %s', aPortName, aBaudRate);
                    
        port.on('data', onData);
      
        port.on('close', function(){
          active = false;
          port = null;
          logger.info(prefix+'port closed');  
        });
      
        port.on('error', function(error){
          logger.error('onError: %s', error);
          if(ikc_t500 && ikc_t500.isOpen()) ikc_t500.close();
          else{
            active = false;
            port = null;
          } 
        });
      
        port.on('disconnect', function(error){
          logger.error('onDisconnect: %s', error);
          if(ikc_t500 && ikc_t500.isOpen()) ikc_t500.close();
          else{
            active = false;
            port = null;
          } 
        });
      
        timer = setInterval(onTimer, 100);
      
        onTimer();
        if(callback) callback(0);
      }
    });
  }catch(e){
    if(callback) callback(-1, e);
  }
};

/**
 * печать комментария (тест кодировки)
 * 
 * @param {Array} arr массив строк
 */
ikc_t500.printComment = function(arr, callback, roll = false){
  var packet = [ADDR_FROM, ADDR_TO, cmdNum++ & 0xff, 0x5c, 0];
  
  for(var i=0;i<arr.length;i++){
    let str = arr[i];
    //разбиваю на строки по 30 символов
    while(str){
      packet.extend( util.convToTerminal(str.slice(0,30)) );
      str = str.slice(30);
    }
  }
    
  // добавляем 4 пустых строки для перемотки
  //if(roll) 
  packet.extend( [0,0,0,0] );
  
  queue.push( {acmd: packet, callback: function(o){
    logger.info(prefix+'printComment result: %s', JSON.stringify(o));
    if(callback) callback(o.state);  
  }});
};


/**
 * Расшифровка кодов ошибок
 *
 * @param {Number} code код ошибки
 * @return {String} Описание ошибки  
 */
ikc_t500.decodeError = function(code){
  switch (code) {
    case -7: return 'чек уже зарегистрирован на сервере';
    case -6: return 'аннулированный чек уже удален';
    case -5: return 'запрошен не существующий жунал';
    case -4: return 'internal: lost command';
    case -3: return 'СОМ-порт не активен';
    case -2: return 'терминал занят';
    case -1: return 'нет ответа';
    case 0: return 'OK';
    case 19: return 'Ошибка контрольной суммы товара';
    case 20: return 'Товар не найден или конец данных при чтении по команде «Следующий»';
    case 37: return 'Дисконтная карта не найдена';
    case 38: return 'Дисконтная карта не действительна';
    case 39: return 'Скидка по дисконтной карте отсутствует';
    case 40: return 'Недопустимая команда';
    case 45: return 'Товарная база заполнена';
    case 50: return 'Необходимо проведение Z-отчета';
    case 55: return 'Онлайн команда отклонена сервером или выполнение прервано пользователем';
    case 63: return 'Ошибка обмена с весами';
    case 88: return 'Онлайн команда не поддерживается сервером';
    case 93: return 'Ошибка контрольной суммы в фискальной памяти';
    case 94: return 'Отсутствует запрашиваемая информация в фискальной памяти';
    case 99: return 'Товарная база испорчена';
    case 150: return 'Недопустимое значение параметра 1';
    case 151: return 'Недопустимое значение параметра 2';
    case 152: return 'Недопустимое значение параметра 3';
    case 153: return 'Недопустимое значение параметра 4';
    case 154: return 'Недопустимое значение параметра 5';
    case 155: return 'Недопустимое значение параметра 6';
    case 156: return 'Недопустимое значение параметра 7';
    case 157: return 'Недопустимое значение параметра 8';
    case 158: return 'Недопустимое значение параметра 9';
    case 159: return 'Недопустимое значение параметра 10';
    case 160: return 'Недопустимая длина команды';
    case 161: return 'Команда «Следующий» неприменима или предыдущая команда была завершена с ошибкой';
    case 162: return 'Конец массива данных при чтении по команде «Следующий»';
    case 163: return 'Товар находится в открытом чеке, невозможно обновить / удалить';
    case 164: return 'Изменение наличия товара приводит к отрицательному результату или переполнению максимального количества';
    case 165: return 'Товарная база не пуста';
    case 166: return 'Изменение даты командой с ПК в фискальном режиме запрещено';
    case 167: return 'Невозможно установить количество кассиров, меньшее номера зарегистрированного кассира';
    case 169: return 'Предыдущий штрих-код не отработан';
    case 170: return 'Требуется регистрация техника';
    case 171: return 'При выполнении команды «Пакет команд» ответ на вложенную команду не поместился в буфер передачи. Эта и следующие вложенные команды не были выполнены.';
    case 254: return 'ОТКАЗ - терминал занят выполнением клавиатурной команды';
    case 255: return 'ЗАНЯТ - терминал или ПК занят выполнением данной команды';
    default:
      return 'неизвестный код ошибки: '+code;
  }
};
