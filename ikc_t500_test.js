'use strict';

/*eslint no-console:0*/
/*eslint no-unused-vars:0*/

var prompt = require('prompt'),
    serialPort = require('serialport'),
    ikc_t500 = require('./ikc_t500_driver'), 
    nconf = require('nconf'),
    request = require('request');

/*
var o = require('./temp/test1.js'),
    var1  = new o(),
    var2  = new o();

var1.setSomeVar(10);
console.log(var2.getSomeVar());
*/

//читаем конфиг из файла
nconf.use('file', {file: './config.json'});
nconf.load();

// считываем порт и скорость
var port = nconf.get('port'), 
    baudRate = nconf.get('baudrate') || 38400;

      
console.log('saved port: '+port+', baudrate: '+baudRate);

prompt.message = '';
prompt.delimiter = '';

prompt.start();

var schema = {
  properties: {
    cmd: {
      description: 'Enter command'
    }}};

var mainmenu = {
  type: 'main',
  items: [{num: 1, desc:'тест кодировки'},
          {num: 2, desc:'выдать товар по порядковому номеру (первый) 0x34 (параметры: <порядковый номер>)'},
          {num: 3, desc:'выдать товар по коду 0x36, (параметры: <код товара>)'},
          {num: 4, desc:'записать товар по порядковому номеру, 0х37 (параметры: <номер товара>)'},
          {num: 5, desc:'записать товар по коду, 0х51, (параметры: <код товара>)'},
          {num: 6, desc:'выдать Z-отчет, 0х44 (параметры: <номер 0..2507>)'},
          {num: 7, desc:'Выдать часовой X-отчёт за период, 0х57 (параметры: <номер 0..23>)'},
          {num: 8, desc:'Чтение параметров электронных журналов'},
          {num: 9, desc:'Чтение электронного журнала (параметры: <номер журнала> <режим 1/2>)'},
          {num: 10, desc:'Очистить базу товаров (параметры: <только сбойные>)'},
          {num: 's', desc: 'Запросить серийный номер'},
          {num: 'd', desc: 'Удалить чек (параметр <номер чека>)'},
          {num: 'gc', desc: 'получить параметры чека (параметр <номер чека>)'}
          ]
};
  
var selectPortMenu = {
  type: 'selectPort',
  items: []
}; 

function getMenuDescByNum(num, arr){
  for(var i=0;i<arr.length;i++){
    if(num==arr[i].num){
      return arr[i].desc;
    }
  }
  return '';
}
  
function RunCycle(arr){
  arr.items.forEach(function(item){
    console.log( item.num+': '+item.desc );
  });
  console.log( 'q: quit' );

  prompt.get(schema, function (err, result) {
    if (err){
      return onErr(err); 
    }
    if(result.cmd==='q'){
      ikc_t500.close();
      return 0;
    }
    else if(arr.type==='selectPort'){
      port = getMenuDescByNum(result.cmd*1, arr.items);
      if(port){
        nconf.set('port', port);
        nconf.set('baudrate', 38400);
        nconf.set('debuglevel', 'info');
        nconf.save(function(err){
          if (err) {
            console.error(err.message);
          }
          console.log('Configuration saved successfully.');
        });
          
        ikc_t500.open(port, baudRate); 
          
        RunCycle( mainmenu );
      }
      else RunCycle( arr );
    }
    else if(arr.type==='main'){
      var cmd = result.cmd.split(' '); 

      switch (cmd[0]) {
        case '1':
          ikc_t500.printComment(['тест кодировки']);
          break;
        case '2':
          //5000
          ikc_t500.getGoodsByNum(cmd[1] || 5000, function(errCode, data){});
          break;
        case '3':
          ikc_t500.getGoodsByCode(cmd[1] || 123456, function(errCode, data){});
          break;
        case '4':
          writeGoodsByNum(cmd[1] || 5000);
          break;
        case '5':
          writeGoodsByCode(cmd[1] || 123456);
          break;
        case '6':
          getZReport( cmd[1] || 0 );
          break;
        case '7':
          ikc_t500.getHourXReport(cmd[1] || 0, function(errCode, data){});
          break;
        case '8':
          ikc_t500.readEJournalParams(function(errCode, data){});
          break;
        case '9':
          ikc_t500.readEJournal(cmd[1] || 0, cmd[2] || 1, function(errCode, data){
            //console.log('чтение журнала завершено с кодом %s', errCode);
          });
          break;
        case '10':
          ikc_t500.clearGoodsBase(true, function(errCode, data){});
          break;
        case 's':
          getSerialNum(cmd[1] || 'serialnum');
          break;
        case 'd':
          ikc_t500.deleteCheque(cmd[1] || 1, function(errCode, data){});
          break;
        case 'gc':
          ikc_t500.getCheque(cmd[1] || 1, function(errCode, data){});
          break;
        default:
          break;
      }
      RunCycle( arr );
    }  
		else RunCycle( arr );
  });
}

function onErr(err) {
  console.log(err);
  return 1;
}

if(port===undefined){
  // если нет конфига, то формируем список портов и запускаем выбор 
  serialPort.list(function (err, ports) {
    var i = 1;
    ports.forEach(function(port) {
      selectPortMenu.items.push( {num: i++, desc: port.comName} );
    });
    RunCycle( selectPortMenu );
  });
}
else {
  // считали порт из конфига - запускаем основное меню 
  ikc_t500.open(port, baudRate); 
  RunCycle( mainmenu );
}

function writeGoodsByNum(num){
  var goodsInfo = new ikc_t500.GoodsInfo({
    numInBase: num,
    price: 600,
    numGoodsGroup: 1,
    attrTaxGroup: 1,
    attrNumPaymentName: 1,
    goodsPresent: 1,
    code: '1152921504606846975',
    name: 'записанный товар'
  });

  ikc_t500.writeGoodsByNum(goodsInfo, function(errCode, data){

  });  
}


function writeGoodsByCode(code){
  var goodsInfo = new ikc_t500.GoodsInfo({
    price: 600,
    numGoodsGroup: 1,
    attrTaxGroup: 1,
    attrNumPaymentName: 1,
    goodsPresent: 100,
    code: code,
    name: 'записанный товар'
  });

  ikc_t500.writeGoodsByCode(goodsInfo, function(errCode, data){

  });  
}

function getSerialNum(data){
  ikc_t500.getSerialNum(function(errCode, data){
    if(errCode===0){
      request.post({
        url:'http://linzcontact.ru/terminal.php', 
        form: {serial: data}}, 
        function(err, httpResponse, body){ 
          console.log( JSON.stringify(body) );
        });
    }  
  });

/*
      request.post({
        url:'http://linzcontact.ru/terminal.php', 
        form: {serial: data}}, 
        function(err, httpResponse, body){ 
          console.log( JSON.stringify(body) );
        });
*/ 
}

function getZReport(){
  // 0..2507
  ikc_t500.getZReport(0, function(errCode, data){
    
  });
}

//********************************************************************

ikc_t500.debuglevel = nconf.get('debuglevel') || 'info';

ikc_t500.onGetDiscountParams = function(num, sum, callback) {
  if(callback){
    setTimeout(function(){
      callback(0, {skidka:10, desc:'демо скидка'} );
    }, 1000);
    return true;
  }
  else return false;  
};

ikc_t500.onGetGoodsDescription = function(goodsCode, callback) {
  if(callback){
    setTimeout(function(){
      var goodsInfo = new ikc_t500.GoodsInfo();
      goodsInfo.price = 1000;
      goodsInfo.numGoodsGroup = 1;
      goodsInfo.attrTaxGroup = 1;
      goodsInfo.attrNumPaymentName = 1;
      goodsInfo.goodsPresent = 10;
      goodsInfo.code = goodsCode;
      goodsInfo.name = 'тестовое название с превышением максимальной длины';
      callback(0, goodsInfo);
    }, 1000);
    return true;
  }
  else return false;  
};

ikc_t500.onGetAllowSale = function(goodsCode, goodsCount, goodsPrice, chequeType, callback) {
  if(callback){
    setTimeout(function(){
      callback(0, {action:0, text:'текст'});
    }, 1000);
    return true;
  }
  else return false;  
};

ikc_t500.onGetAllowPay = function(payType, sum, chequeType, callback) {
  if(callback){
    setTimeout(function(){
      callback(0, {action:0, text:'текст'});
    }, 1000);
    return true;
  }
  else return false;  
};

ikc_t500.onMsgCloseCheque = function(callback){
  callback(0);
};
