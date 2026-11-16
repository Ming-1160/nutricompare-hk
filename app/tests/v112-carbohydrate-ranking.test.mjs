import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, nutritionFor, rankingGroups } from '../engine.mjs?v=112';

const food=(id,carbohydrates,carbohydrateDefinition,basisUnit='g')=>({
  id,nameEn:id,prices:[],allergens:{status:'unknown',contains:[],mayContain:[]},
  nutrition:{basisAmount:100,basisUnit,carbohydrates,carbohydrateDefinition,sugars:carbohydrates},
});

test('carbohydrate order separates total and available definitions and does not rank unspecified definitions',()=>{
  const products=[
    food('unknown-definition-small',1,undefined),
    food('available-high',30,'available'),
    food('total-low',2,'total'),
    food('available-low',20,'available'),
    food('total-high',40,'total'),
    food('unknown-definition-large',90,undefined),
    food('missing-value',null,'available'),
    food('unknown-unit',0,'total',null),
  ];
  const before=JSON.stringify(products);
  assert.deepEqual(filterProducts(products,{sort:'carbs-asc'}).map(p=>p.id),[
    'available-low','available-high','total-low','total-high',
    'unknown-definition-small','unknown-definition-large','missing-value','unknown-unit',
  ]);
  assert.deepEqual(rankingGroups(products,'carbs-asc'),[
    {unit:'g',carbohydrateDefinition:'available',count:2},
    {unit:'g',carbohydrateDefinition:'total',count:2},
  ]);
  assert.equal(nutritionFor(products[0]).carbohydrates,1,'the source figure remains visible even when it cannot rank');
  assert.equal(JSON.stringify(products),before,'source data is not rewritten');
  assert.deepEqual(filterProducts(products,{sort:'sugar-asc'}).slice(0,3).map(p=>p.id),[
    'unknown-definition-small','total-low','available-low',
  ],'sugar ranking remains independent of carbohydrate definition');
});

test('carbohydrate groups also retain g/ml separation and stable order for unrankable values',()=>{
  const products=[food('ml-high',10,'total','ml'),food('g-low',1,'total'),
    food('ml-low',5,'total','ml'),food('unspecified-high',100,undefined),food('unspecified-low',0,undefined)];
  assert.deepEqual(filterProducts(products,{sort:'carbs-asc'}).map(p=>p.id),[
    'ml-low','ml-high','g-low','unspecified-high','unspecified-low',
  ]);
  assert.deepEqual(rankingGroups(products,'carbs-asc'),[
    {unit:'ml',carbohydrateDefinition:'total',count:2},
    {unit:'g',carbohydrateDefinition:'total',count:1},
  ]);
  assert.deepEqual(rankingGroups([food('unspecified',2,undefined)],'carbs-asc'),[]);
});
