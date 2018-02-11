'use strict';

/*eslint no-undef:0*/

var chai = require('chai'),
    assert = chai.assert,
    expect = chai.expect,
    BigInt = require('node-biginteger'),
    util = require('../util.js');

chai.should();

describe('util.js', function() {
  it('должна быть функция #copyArray', function () {
    util.should.be.have.property('copyArray');
    util.copyArray.should.be.a('function');
  });

  describe('#copyArray', function() {
    it('должна копировать часть массива, кроме последнего байта (CRC)', function() {
      var shift = {value: 1},
          aFrom = [1,2,3],
          aTo = [];
      util.copyArray(aFrom, aTo, shift, 2);
      assert.deepEqual(aTo, [2], 'ошибка копирования');
      assert.equal(shift.value, 2, 'неверная позиция указателя после копирования');
    });
  });

  it('должна быть функция #array2uintXX', function () {
    util.should.be.have.property('array2uintXX');
    util.array2uintXX.should.be.a('function');
  });

  describe('#array2uintXX', function() {
    it('должна преобразовывать часть массива в Number или BigInt (little-endian)', function() {
      let shift = {value: 0},
          src = [1, 0,1, 2,0,0, 3,0,0,0, 4,0,0,0,0,0,0,0xf, 0xed];
      
      assert.equal(util.array2uintXX(src, shift, 1), 1, 'ошибка преобразования в BYTE');
      assert(shift.value===1, 'неверная позиция чтения после BYTE');
      assert.equal(util.array2uintXX(src, shift, 2), 256, 'ошибка преобразования в INT16');
      assert(shift.value===3, 'неверная позиция чтения после INT16');
      assert.equal(util.array2uintXX(src, shift, 3), 2, 'ошибка преобразования в INT24');
      assert(shift.value===6, 'неверная позиция чтения после INT24');
      assert.equal(util.array2uintXX(src, shift, 4), 3, 'ошибка преобразования в INT32');
      assert(shift.value===10, 'неверная позиция чтения после INT32');

      let res = util.array2uintXX(src, shift, 8);
      assert(shift.value===18, 'неверная позиция чтения после INT64');

      assert.instanceOf(res, BigInt, 'должна возвращать BigInt');

      if(res instanceof BigInt)
        assert.equal(res.toString(), '1080863910568919044', 'ошибка преобразования в INT64');
    });

    it('должна выдавать исключение при не верных параметрах', function(){
      expect(util.array2uintXX.bind(undefined, '123')).to.throw(Error, 'первым параметром должен быть массив');
      expect(util.array2uintXX.bind(undefined, [1], undefined)).to.throw(Error, 'вторым параметром должен быть объект');
      expect(util.array2uintXX.bind(undefined, [1], {novalue:1})).to.throw(Error, 'во втором параметре должно быть свойство "value"');
      expect(util.array2uintXX.bind(undefined, [1], {value:1}, 'qq')).to.throw(Error, 'третим параметром должно быть число');
    });
  });

  it('должна быть функция #uintXXA', function () {
    util.should.be.have.property('uintXXA');
    util.uintXXA.should.be.a('function');
  });
  
  describe('#uintXXA', function() {
    it('должна преобразовывать Number или BigInt в массив байт (little-endian)', function() {
      assert.deepEqual(util.uintXXA(1, 1), [1], 'ошибка преобразования INT8');
      assert.deepEqual(util.uintXXA(500, 2), [244,1], 'ошибка преобразования INT16');
      assert.deepEqual(util.uintXXA(500000, 4), [32,161,7,0], 'ошибка преобразования INT32');
      assert.deepEqual(util.uintXXA('1080863910568919044', 8), [4,0,0,0,0,0,0,0xf], 'ошибка преобразования INT64');
      assert.deepEqual(util.uintXXA(BigInt.fromString('1080863910568919044'), 8), [4,0,0,0,0,0,0,0xf], 'ошибка преобразования INT64');
    });
/*
    it('должна выдавать исключение при не верных параметрах', function(){
      expect(util.uintXXA.bind(undefined, 'z', 1)).to.throw(Error, 'anyToNumber convert error:');
      expect(util.uintXXA.bind(undefined, {qq:1}, 1)).to.throw(Error, 'anyToNumber convert error:');
      expect(util.uintXXA.bind(undefined, BigInt.fromString('z'), 1)).to.throw(Error, 'anyToNumber convert error:');
      expect(util.uintXXA.bind(undefined, BigInt.fromString('z'), 8)).to.throw(Error, 'первым параметром должно быть число, строка или BigInt');
      expect(util.uintXXA.bind(undefined, 'zz', 8)).to.throw(Error, 'первым параметром должно быть число, строка или BigInt');
      expect(util.uintXXA.bind(undefined, 1, 'qq')).to.throw(Error, 'anyToNumber convert error:');
    });
*/    
  });

  it('должна быть функция #anyToNumber', function () {
    util.should.be.have.property('anyToNumber');
    util.anyToNumber.should.be.a('function');
  });

  describe('#anyToNumber', function() {
    it('должна преобразовывать валидные числа в Number', function(){
      assert(util.anyToNumber(1)===1, 'ошибка преобразования Number to Number');
      assert(util.anyToNumber('2')===2, 'ошибка преобразования String to Number');
      assert(util.anyToNumber( BigInt.fromString('3') )===3, 'ошибка преобразования BigInt to Number');
    });

    it('должна выдавать исключение при не верных параметрах', function(){
      expect(util.anyToNumber.bind(undefined, 'z')).to.throw(Error, 'anyToNumber convert error:');
      expect(util.anyToNumber.bind(undefined, {qq:1})).to.throw(Error, 'anyToNumber convert error:');
      expect(util.anyToNumber.bind(undefined, BigInt.fromString('z'), 1)).to.throw(Error, 'anyToNumber convert error:');
    });
  });

  it('должна быть функция #anyToBigInt', function () {
    util.should.be.have.property('anyToBigInt');
    util.anyToBigInt.should.be.a('function');
  });

  describe('#anyToBigInt', function() {
    it('должна преобразовывать валидные числа в BigInt', function(){
      assert.deepEqual(util.anyToBigInt(1), BigInt.fromString('1'), 'ошибка преобразования Number to BigInt');
      assert.deepEqual(util.anyToBigInt('1080863910568919044'), BigInt.fromString('1080863910568919044'), 'ошибка преобразования String to BigInt');
      assert.deepEqual(util.anyToBigInt( BigInt.fromString('3') ), BigInt.fromString('3'), 'ошибка преобразования BigInt to BigInt');
    });

    it('должна выдавать исключение при не верных параметрах', function(){
      expect(util.anyToBigInt.bind(undefined, 'z')).to.throw(Error, 'anyToBigInt convert error:');
      expect(util.anyToBigInt.bind(undefined, {qq:1})).to.throw(Error, 'anyToBigInt convert error:');
      expect(util.anyToBigInt.bind(undefined, BigInt.fromString('z'), 1)).to.throw(Error, 'anyToBigInt convert error:');
    });
  });
  
  it('должна быть функция #convToTerminal', function () {
    util.should.be.have.property('convToTerminal');
    util.convToTerminal.should.be.a('function');
  });

  describe('#convToTerminal', function() {
    it('должна преобразовывать строку в массив байт, заканчивающийся 0', function(){
      assert.deepEqual(util.convToTerminal('тест кодировки'), [242,229,241,242,32,234,238,228,232,240,238,226,234,232,0], 'ошибка преобразования строки');
      assert.deepEqual(util.convToTerminal('тест кодировки', 4), [242,229,241,242,0], 'ошибка преобразования ограниченной строки');
    });

    it('должна выдавать исключение при не верных параметрах', function(){
      expect(util.convToTerminal.bind(undefined, 123)).to.throw(Error, 'convToTerminal error:');
      expect(util.convToTerminal.bind(undefined, {qq:'123'})).to.throw(Error, 'convToTerminal error:');
    });
  });
  
  it('должна быть функция #convToUTF8', function () {
    util.should.be.have.property('convToUTF8');
    util.convToUTF8.should.be.a('function');
  });

  describe('#convToUTF8', function() {
    it('должна преобразовывать массив байт заканчивающийся 0 в строку', function(){
      let shift = {value:0};
      assert.equal(util.convToUTF8([242,229,241,242,32,234,238,228,232,240,238,226,234,232,0], shift), 'тест кодировки', 'ошибка преобразования массива');
    });

    it('должна выдавать исключение при не верных параметрах', function(){
      let shift = {value:0};
      expect(util.convToUTF8.bind(undefined, '123', shift)).to.throw(Error, 'convToUTF8 error:');
      expect(util.convToUTF8.bind(undefined, {qq:'123'}, shift)).to.throw(Error, 'convToUTF8 error:');
    });
  });
});
