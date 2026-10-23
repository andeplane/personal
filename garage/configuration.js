// Independent choices; rear storage never changes the user's wall selections.
function configuration(){return {
 rear:root.querySelector('#rear-storage').value,
 recess:root.querySelector('#recess-storage').value,
 upperLeft:Number(root.querySelector('#upper-left').value),
 upperRight:root.querySelector('#upper-right').checked,
 upperRear:root.querySelector('#upper-rear').checked
};}
function composePlan(c=configuration()){
 const rear=data.rearOptions.find(a=>a.id===c.rear)||data.rearOptions.find(a=>a.id===data.defaults.rear);
 return {...rear,recessMode:c.recess,upperRuns:c.upperLeft,upperRight:c.upperRight,upperRear:c.upperRear};
}
function currentPlan(){return composePlan();}
