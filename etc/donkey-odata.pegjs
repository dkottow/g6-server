

start
 = param

/*
params
 = first:param 
   rest:("&" param:param { return param; })*	
   { var result = {}; 
	 result[first.name] = first.value;	
     for(var i=0;i<rest.length;++i) result[rest[i].name] = rest[i].value;
     return result;
   }
*/

param
 = paramSkip
 / paramTop
 / paramOrderBy
 / paramFilter
 / paramSelect

paramSkip
 = "$skip=" a:$int 
   {return {name: '$skip', value: parseInt(a) }; }
 
paramTop
 = "$top=" a:$int 
   {return {name: '$top', value: parseInt(a) }; }

paramOrderBy
 = "$orderby=" expr:orderByExpr 
   { return {name: '$orderby', value: expr}; }

paramSelect
 = "$select=" fields:fields 
   { return {name: '$select', value: fields}; }

paramFilter
 = "$filter=" filters:filterExpr 
   { return {name: '$filter', value: filters}; }

orderByExpr
 = first:orderByTerm
   rest:("," ws? term:orderByTerm { return term; })*
   { return [first].concat(rest); }

orderByTerm
 = field:field ord:(ws ord:('asc'i / 'desc'i) {return ord; })?
   { var result = {}; result[field] = ord || 'asc';  return result; }

filterExpr
 = first:filterTerm 
   rest:(ws "and" ws term:filterTerm { return term; })*	
   { return [first].concat(rest); }

filterTerm
 = field:field ws op:op ws value:value 
   { return {field:field, operator: op, value: value }; }

op "operator"
 = "eq" 
 / "ne" 
 / "ge" 
 / "gt"
 / "le"
 / "lt"
 / "search"
 / "in"

fields
 = first:field
   rest:("," ws? field:field { return field; })*
   { return [first].concat(rest); }

field "field name"
 = first:[a-z]i chars:fchar* 
   { return first + chars.join(''); }

fchar "name char"
 = [a-z0-9_]i

values
 = first:value
   rest:("," ws? value:value { return value; })*
   { return [first].concat(rest); }

value
 = number
 / string


/**** from json *****/

ws "whitespace" = [ \t\n\r]+

/* ----- 6. Numbers ----- */

number "number"
  = minus? int frac? exp? { return parseFloat(text()); }

decimal_point = "."
digit1_9      = [1-9]
e             = [eE]
exp           = e (minus / plus)? DIGIT+
frac          = decimal_point DIGIT+
int           = zero / (digit1_9 DIGIT*)
minus         = "-"
plus          = "+"
zero          = "0"

/* ----- 7. Strings ----- */

string "string"
  = quotation_mark chars:char* quotation_mark { return chars.join(""); }

char
  = unescaped
  / escape
    sequence:(
        "'"
      / "\\"
      / "/"
      / "b" { return "\b"; }
      / "f" { return "\f"; }
      / "n" { return "\n"; }
      / "r" { return "\r"; }
      / "t" { return "\t"; }
      / "u" digits:$(HEXDIG HEXDIG HEXDIG HEXDIG) {
          return String.fromCharCode(parseInt(digits, 16));
        }
    )
    { return sequence; }

escape         = "\\"
quotation_mark = "'"
unescaped      = [\x20-\x26\x28-\x5B\x5D-\u10FFFF]

/* ----- Core ABNF Rules ----- */

/* See RFC 4234, Appendix B (http://tools.ietf.org/html/rfc4627). */
DIGIT  = [0-9]
HEXDIG = [0-9a-f]i

