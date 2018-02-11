'use strict';

let BigInt = require('node-biginteger');

/**
 * копирует из исходного массива aFrom в массив aTo maxLen байт начиная с позиции shift.value
 * 
 * @param {Array} aFrom исходный массив БАЙТ
 * @param {Array} aTo целевой массив БАЙТ
 * @param {Object} shift {value:0} - объект с позицией чтения
 * @param {Number} maxLen количество байт для чтения 
 */
let copyArray = function(aFrom, aTo, shift, maxLen){
  // оригинальный буфер заканчивается CRC - он нам не нужен
  while(shift.value<(aFrom.length-1) && (maxLen>0)){
    aTo.push( aFrom[shift.value++] & 0xff );
    maxLen--;
  }
};

/**
 * Преобразует массив байт в целое (little-endian)
 * 
 * @param {Array} arr массив байт
 * @param {Object} shift смещение в массиве {value:1} - передается объектом, чтобы получить результат 
 * @param {Number} bytes размерность результата (в байтах)
 * @return {Number | BigInt} 
 */
let array2uintXX = function(arr, shift, bytes){
  if(!Array.isArray(arr)) throw new Error('первым параметром должен быть массив');
  if(typeof(shift)!=='object') throw new Error('вторым параметром должен быть объект');
  if(typeof(shift.value)==='undefined') throw new Error('во втором параметре должно быть свойство "value"');
  bytes = Number(bytes);
  if(isNaN(bytes)) throw new Error('третим параметром должно быть число');

  var abLen, u8aShift = 0;
  if(bytes===3){
    abLen = 4;
    u8aShift = 1;
  }
  else abLen = bytes;

  var ab = new ArrayBuffer(abLen),
      u8a = new Uint8Array(ab),
      dv = new DataView(ab);

  for(var i=0;i<bytes;i++) u8a[i+u8aShift] = arr[shift.value+bytes-i-1];

  shift.value += bytes;

  switch (bytes) {
    case 1: return dv.getInt8(0) & 0xff;
    case 2: return dv.getInt16(0) & 0xffff;
    case 3:
    case 4: 
      return dv.getInt32(0) & 0xffffffff;
    case 8: 
      return BigInt.fromBuffer(1, u8a);
    default: return 0;
  }
};

/**
 * Преобразует любое валидное представление числа в Number
 * 
 * @param {String|BigInt} value
 * @return {Number}  
 */
let anyToNumber = function(value){
  if(value instanceof BigInt){ 
    if(value.mag.length===0 || isNaN(value.mag[0]))
      throw new Error('anyToNumber convert error: BigInt has empty mag');
    value = Number(value.toString());
  }
  else 
    value = Number(value);

  if(isNaN(value)) throw new Error('anyToNumber convert error: isNaN');

  return value;
};


/**
 * Преобразует любое валидное представление числа в BigInt
 * 
 * @param {String|BigInt|Number} value
 * @return {BigInt}  
 */
let anyToBigInt = function(value){
  if(!(value instanceof BigInt)){
    if(typeof(value)==='string')
      value = BigInt.fromString(value);
    else{
      // мелкое число может быть и Number
      value = Number(value);
      if(isNaN(value)) throw new Error('anyToBigInt convert error: isNaN');
      value = BigInt.fromString(value.toString());
    }
  }

  if(value.mag.length===0 || isNaN(value.mag[0]))
    throw new Error('anyToBigInt convert error: BigInt has empty mag');

  return value;
};


/**
 * Преобразует беззнаковое целое в массив байт (little-endian)
 * 
 * @param {Number | String | BigInt} value исходное значение
 * @param {Number} bytes требуемая разрядность (в байтах)
 * @return {Array} массив байт
 */
var uintXXA = function(value, bytes){
  bytes = anyToNumber(bytes);

  if(bytes===8) //переводим в BigInt
    value = anyToBigInt(value);
  else
    value = anyToNumber(value);

  var ab = new ArrayBuffer(bytes),
      u8a = new Uint8Array(ab),
      dv = new DataView(ab);
      
  switch (bytes) {
    case 1: // int8
      dv.setUint8(0, value);
      break;
    case 2: // int16
      dv.setUint16(0, value);
      break;
    case 4: // int32
      dv.setUint32(0, value);
      break;
    case 8: // INT64
      var buf = value.toBuffer();
      //if(value instanceof BigInt) buf = value.toBuffer(); else 
      //buf = BigInt.fromString(value).toBuffer();
      // размер буфера может быть меньше 8
      for(var i=0;i<buf.length;i++) u8a[7-i] = buf[buf.length-i-1];
      break;
  }

  var res = new Array(bytes);  
  for(let i=0;i<res.length;i++) res[i] = u8a[bytes-i-1];
    
  return res;  
};

/**
 * Разбор блока и запись в массив чеков
 */
/*
function parseBlock(currentBlock, cheques){
  var item = {chequeNum: currentBlock.chequeNum, body: []}, shift = {value:0};
  if(currentBlock.format===1){
    // текстовый формат

    item.format = 1;

    var readed = 0, sArr = [];

    while(readed<currentBlock.chequeLen){
      var ch = array2uintXX(currentBlock.buf, shift, INT8) & 0xff;
      readed++;

      if(ch===0){
        if(sArr.length){
          let str = convToUTF8(sArr, {value:0});
          logger.debug(prefix+'"'+str+'"');
          item.body.push( str );
          sArr.length = 0;
        }

        for(var i=0;i<TEXT_CHEQUE_STRLEN+1;i++)
          sArr.push( 45 );

        let str = convToUTF8(sArr, {value:0});
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
            let str = convToUTF8(sArr, {value:0});
            logger.debug(prefix+'"'+str+'"');
            item.body.push( str );
            sArr.length = 0;
          }
        }
      }
      else 
        sArr.push( ch );

      if(sArr.length>TEXT_CHEQUE_STRLEN){
        var str = convToUTF8(sArr, {value:0});
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
*/

//кодировка терминала
const chars = [0x402, 0x403, 0x201a, 0x403, 0x201e, 0x2026,    0x2020, 0x2021, 0x20ac, 0x2030, 0x409, 0x2039, 0x40a, 0x40c, 0x40b, 0x40f,
               0x452, 0x2018,0x2019, 0x201c,0x201d, 0x2022,    0x2013, 0x2014, 0x20,   0x2122, 0x409, 0x203a, 0x45a, 0x45c, 0x45b, 0x45f,
               0x20,  0x40e, 0x45e,  0x408, 0xa4,   0x490,     0xa6,   0xa7,   0x401,  0xa9,   0x404, 0xab,   0x2510,0x2500,0xae,  0x407,
               0xb0,  0xb1,  0x406,  0x456, 0x491,  0x20/*Mю*/,0xb6,   0xb7,   0x451,  0x2116, 0x454, 0xbb,   0x458, 0x405, 0x455, 0x457,
               0x410, 0x411, 0x412,  0x413, 0x414,  0x415,     0x416,  0x417,  0x418,  0x419,  0x41a, 0x41b,  0x41c, 0x41d, 0x41e, 0x41f,
               0x420, 0x421, 0x422,  0x423, 0x424,  0x425,     0x426,  0x427,  0x428,  0x429,  0x42a, 0x42b,  0x42c, 0x42d, 0x42e, 0x42f,
               0x430, 0x431, 0x432,  0x433, 0x434,  0x435,     0x436,  0x437,  0x438,  0x439,  0x43a, 0x43b,  0x43c, 0x43d, 0x43e, 0x43f,
               0x440, 0x441, 0x442,  0x443, 0x444,  0x445,     0x446,  0x447,  0x448,  0x449,  0x44a, 0x44b,  0x44c, 0x44d, 0x44e, 0x44f];


/**
 * Перекодировка 0-терминированной строки в UTF-8
 * 
 * @param {Array} arr массив байт, содержащий 0-терминированную строку
 * @return {String} строка в UTF-8
 */
let convToUTF8 = function(arr, offset){
  if(!Array.isArray(arr)) throw new Error('convToUTF8 error: первым параметром должен быть массив');
  if(typeof(offset)!=='object') throw new Error('convToUTF8 error: вторым параметром должен быть объект');
  if(typeof(offset.value)==='undefined') throw new Error('convToUTF8 error: во втором параметре должно быть свойство "value"');

  let res = '';
  for(let i=offset.value;i<arr.length;i++){
    offset.value++;
    if(arr[i]===0) break;
    if(arr[i]<128) res += String.fromCharCode(arr[i]);
    else res += String.fromCharCode( chars[ arr[i] & 0x7f ] );
  }
    
  return res;   
};

/**
 * Формирует 0-терминированную строку в кодировке терминала
 * 
 * @param {String} str строка в кодировке UTF-8
 * @return {Array} Байтовый массив
 */
let convToTerminal = function(str, maxLen){
  if(typeof(str)!=='string') throw new Error('convToTerminal error: первым параметром должна быть строка');

  if(maxLen) str = str.substr(0, maxLen);

  let res = new Array(str.length+1);
  
  for(let i=0;i<str.length;i++){
    let ch = str.charCodeAt(i);
    if(ch<128) res[i] = ch;
    else{
      let num = chars.indexOf(ch);
      if(num>=0) res[i] = 128+num;
      else res[i] = 32;
    }   
  }
  res[str.length] = 0;
  return res;
};

module.exports = {
  copyArray,
  array2uintXX,
  uintXXA,
  anyToNumber,
  anyToBigInt,
  convToUTF8,
  convToTerminal
}; 