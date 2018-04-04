# createNested
loopback mixing add method createNested which allow the creation of post data with relations included, using transactions.

I will create a npm package soon, meanwhile install as follows:
download source code, install async npm package at root of loopback, npm install async, next edit server/model-config.json
add to "mixins" the location where you copied the source code, in my case: [
      "loopback/common/mixins",
      "loopback/server/mixins",
      "../node_modules/loopback-ds-timestamp-mixin",
      "../node_modules/loopback-cascade-delete-mixin",
      "../common/mixins",
      "./mixins",
      "../custom/createNested" -> here
    ]
Then select the models in which you want to have the method createNested adding the line to mixins example of my model:
"mixins": {
    "TimeStamp": {
      "createdAt": "created",
      "updatedAt": "modified",
      "required": true,
      "validateUpsert": true,
      "silenceWarnings": false
    },
    "CreateNested":{ } ->here;
  },
  
  
Usage example:

Posting data to createNested in my client model:
Postdata:
{'name':'IBM',
'gardens':[{'name':'California','screens':[{'plant_count':29,'description':'','dimensions':....}]},
          {'name':'Atlanta','screens':{'plant_count':33,'description':''...}]};
    
 The code will start a transaction with mode isolationLevel:'READ COMMITTED' creating the data through a 
 set of nested Promises, using builtin loopback methods, which means that validations, hooks and ACL are executed,
 in which case a validations fails the transaction rollbacks, the same in regard to the ACL, if in the posted data a
 relation is included and the user don't have access to the "create" method of the relation model it will 
 throw a error and rollback.
 
 Is up to you to check that all included relations relay on the same datasource, if a relation is in another datasource
 and error will occour and you will enter in a unknown dimension. 
 
 If you have attached hooks on the
 relation models or the base model itself, if you create an hook "on create" in the client model and in the logic of the 
 hook you create a record in another model like says Tasks, then make sure at the moment of Task creation to include in the options the Transaction which is included in context.options.transaction so in case of a failure Task will be too rolledback.
 
