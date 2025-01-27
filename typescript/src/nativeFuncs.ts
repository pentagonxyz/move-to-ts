import { HexString } from "aptos";
import { AptosDataCache, IBox, ITable } from "./aptosDataCache";
import { U128, U64, U8 } from "./builtinTypes";
import { AtomicTypeTag, getTypeParamsString, parseTypeTagOrThrow, StructTag, substituteTypeParams, TypeParamIdx, TypeTag, VectorTag } from "./typeTag";
import * as sha from "sha.js";
import { SHA3 } from "sha3";
import bigInt from "big-integer";
import * as elliptic from "elliptic";
import { BCS } from "aptos";
import { FieldDeclType, StructInfoType, TypeParamDeclType } from "./parserRepo";
import { u64, u8str } from "./builtinFuncs";


/*
BCS serialization of Move values
*/

export function serializeVector(serializer: BCS.Serializer, v: any, elementTag: TypeTag) {
    if (!(v instanceof Array)) {
      throw new Error("Expected v to be a vector/array");
    }
    serializer.serializeU32AsUleb128(v.length);
    for(const element of v) {
      serializeMoveValue(serializer, element, elementTag);
    }
}

export function serializeStruct(serializer: BCS.Serializer, v: any, tag: StructTag) {
  if (typeof v !== 'object') {
    throw new Error("serializeStruct expected an object input as v");
  }
  const ctor = v.constructor;
  if (!ctor) {
    throw new Error("Struct value should have a constructor!");
  }
  const structDef = ctor as unknown as StructInfoType;
  for (const field of structDef.fields) {
    const concreteTag = substituteTypeParams(field.typeTag, tag.typeParams);
    serializeMoveValue(serializer, v[field.name], concreteTag);
  }
}

function addressToUint8Array(h: HexString) {
  const noPrefix = h.noPrefix();
  // build a hexString of 64 hexadecimal digits
  const full = '0'.repeat(64 - noPrefix.length) + noPrefix;
  const buf = Buffer.from(full, 'hex');
  return Uint8Array.from(buf);
}

export function serializeMoveValue(serializer: BCS.Serializer, v: any, tag: TypeTag) {
  if (tag === AtomicTypeTag.Address) {
    if (!(v instanceof HexString)) {
      throw new Error('Expected value to be HexString');
    }
    serializer.serializeFixedBytes(addressToUint8Array(v));
  }
  else if (tag === AtomicTypeTag.Signer) {
    throw new Error("Cannot serialize signer!");
  }
  else if (tag === AtomicTypeTag.Bool) {
    if (!(typeof v === 'boolean')) {
      throw new Error('Expected value to be boolean');
    }
    serializer.serializeBool(v);
  }
  else if (tag === AtomicTypeTag.U8) {
    if (!(v instanceof U8)) {
      throw new Error('Expected value to be U8');
    }
    serializer.serializeU8(v.toJsNumber());
  }
  else if (tag === AtomicTypeTag.U64) {
    if (!(v instanceof U64)) {
      throw new Error('Expected value to be U64');
    }
    serializer.serializeU64(v.toBigInt());
  }
  else if (tag === AtomicTypeTag.U128) {
    if (!(v instanceof U128)) {
      throw new Error('Expected value to be U128');
    }
    serializer.serializeU64(v.toBigInt());
  }
  else if (tag instanceof VectorTag) {
    serializeVector(serializer, v, tag.elementType);
  }
  else if (tag instanceof StructTag) {
    serializeStruct(serializer, v, tag);
  }
  else if (v instanceof TypeParamIdx) {
      throw new Error("BCS serialization expected concrete TypeTag but received TypeParamIdx");
  }
  else {
    throw new Error("Unreachable");
  }
}

/*
native functions from Std
*/
export function std_bcs_to_bytes(v: any, $c: AptosDataCache, tags: TypeTag[]): U8[] {
  if (tags.length !== 1) {
    throw new Error(`Expected 1 TypeTag in tags but received: ${tags.length}`);
  }
  const serializer = new BCS.Serializer();
  serializeMoveValue(serializer, v, tags[0]);
  const array = Array.from(serializer.getBytes());
  return array.map(u => new U8(bigInt(u)));
}

export function std_debug_print(v: any, $c: AptosDataCache, _: TypeTag[]) {
  console.log(JSON.stringify(v, null, 2));
}

export function std_debug_print_stack_trace($c: AptosDataCache) {
  // NOP
}

export function std_event_write_to_event_store(guid: U8[], count: U64, msg: any, $c: AptosDataCache, _tags: TypeTag[]) {
  // FIXME: should probably allow some callback/prints??
  // NOP
}

export function std_hash_sip_hash(v: any, $c: AptosDataCache, _tags: TypeTag[]): U64 {
  throw new Error("Not implemented");
}

export function std_hash_sha2_256(data: U8[], $c: AptosDataCache): U8[] {
  const dataBuffer = Buffer.from(data.map(u => u.value.toJSNumber()));
  const outputBuffer = new sha.sha256().update(dataBuffer).digest();
  return Array.from(outputBuffer).map(u => new U8(bigInt(u)));
}

export function std_hash_sha3_256(data: U8[], $c: AptosDataCache): U8[] {
  const dataBuffer = Buffer.from(data.map(u => u.value.toJSNumber()));
  const outputBuffer = new SHA3(256).update(dataBuffer).digest();
  return Array.from(outputBuffer).map(u => new U8(bigInt(u)));
}

export function std_signer_borrow_address(s: HexString, $c: AptosDataCache) {
  return s;
}

export function std_string_internal_check_utf8(v: U8[], $c: AptosDataCache): boolean {
  const bytes = new Uint8Array(v.map(u => u.toJsNumber()));
  const decoder = new TextDecoder('utf-8', {fatal: true});
  try{
    decoder.decode(bytes);
    return true;
  }
  catch(e) {
    return false;
  }
}

export function std_string_internal_is_char_boundary(v: U8[], i: U64, $c: AptosDataCache): boolean {
  if (i.toJsNumber() > v.length) {
    return false;
  }
  return std_string_internal_check_utf8(v.slice(0, i.toJsNumber()), $c);
}

export function std_string_internal_sub_string(v: U8[], i: U64, j: U64, $c: AptosDataCache): U8[] {
  const [ii, jj] = [i.toJsNumber(), j.toJsNumber()];
  if (!std_string_internal_is_char_boundary(v, i, $c)) {
    throw new Error(`sub_string start index ${ii} is not utf8 char boundary`);
  }
  if (!std_string_internal_is_char_boundary(v, j, $c)) {
    throw new Error(`sub_string end index ${jj} is not utf8 char boundary`);
  }
  if (ii > jj) {
    throw new Error(`Substring start index ${ii} greater than ending index ${jj}`);
  }
  return v.slice(ii, jj);
}

export function std_string_internal_index_of(v: U8[], r: U8[], $c: AptosDataCache): U64 {
  const vv = new Uint8Array(v.map(u => u.toJsNumber()));
  const rr = new Uint8Array(r.map(u => u.toJsNumber()));
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const vStr = decoder.decode(vv);
  const rStr = decoder.decode(rr);
  const idx = vStr.indexOf(rStr);
  return u64(idx === -1 ? v.length : idx);
}

export function std_unit_test_create_signers_for_testing(numSigners: U64, $c: AptosDataCache) : HexString[] {
  const result: HexString[] = [];
  for(let i = 0; i < numSigners.value.toJSNumber(); i++) {
    result.push(new HexString((0x1000 + i).toString(16)));
  }
  return result;
}

export function std_vector_empty($c: AptosDataCache, tags: TypeTag[]): any[] {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  return [];
}

export function std_vector_length(vec: any[], $c: AptosDataCache, tags: TypeTag[]): U64 {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  return new U64(bigInt(vec.length));
}


export function std_vector_borrow(vec: any[], i: U64, $c: AptosDataCache, tags: TypeTag[]): any {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  const idx = i.value.toJSNumber();
  if ( idx >= vec.length ) {
    throw new Error(`Index out of bounds: ${idx} >= ${vec.length}`);
  }
  return vec[idx];
}

export function std_vector_push_back(vec: any[], e: any, $c: AptosDataCache, tags: TypeTag[]): void {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  vec.push(e);
}

export function std_vector_borrow_mut(vec: any[], i: U64, $c: AptosDataCache, tags: TypeTag[]): any {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  const idx = i.value.toJSNumber();
  if ( idx >= vec.length ) {
    throw new Error(`Index out of bounds: ${idx} >= ${vec.length}`);
  }
  // FIXME: we should probably wrap &mut in a MutRef object with a $set method
  return vec[idx];
}

export function std_vector_pop_back(vec: any[], $c: AptosDataCache, tags: TypeTag[]): void {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  if (vec.length === 0) {
    throw new Error("Trying to pop vector with 0 length");
  }
  return vec.pop();
}

export function std_vector_destroy_empty(vec: any[], $c: AptosDataCache, tags: TypeTag[]): void {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  if (vec.length !== 0 ) {
    throw new Error("Vector is not empty!");
  }
}

export function std_vector_swap(vec: any[], i: U64, j: U64, $c: AptosDataCache, tags: TypeTag[]): void {
  if (tags.length !== 1) {
    throw new Error(`Incorrect number of type arguments: ${tags.length}`);
  }
  const idx = i.value.toJSNumber();
  const jdx = j.value.toJSNumber();
  if ( idx >= vec.length ) {
    throw new Error(`Index out of bounds: ${idx} >= ${vec.length}`);
  }
  if ( jdx >= vec.length ) {
    throw new Error(`Index out of bounds: ${jdx} >= ${vec.length}`);
  }
  [vec[idx], vec[jdx]] = [vec[jdx], vec[idx]];
}

/*
native functions from AptosFramework
*/

export function aptos_framework_account_create_address(bytes: U8[], $c: AptosDataCache): HexString {
  if (bytes.length !== 32) {
    throw new Error(`bytes must have length of 32, but got ${bytes.length}`);
  }
  const bytesArray = new Uint8Array(bytes.map(u => u.value.toJSNumber()));
  return HexString.fromUint8Array(bytesArray);
}

export function aptos_framework_account_create_signer(addr: HexString, $c: AptosDataCache): HexString {
  // FIXME
  // yep, our runtime does not distinguish between address and signer. This might get us in trouble down the road... 
  // but for now just use this
  return addr;
}

function u8ArrayToKeyString(u8array: U8[]): string {
  return u8array.map(u => u.value.toJSNumber().toString(16)).join();
}

export function aptos_framework_signature_ed25519_validate_pubkey(pubkey: U8[], $c: AptosDataCache): boolean {
  throw new Error("Not implemented");
}

export function aptos_framework_signature_bls12381_validate_pubkey(pubkey: U8[], proof: U8[], $c: AptosDataCache): boolean {
  throw new Error("Not implemented");
  /*
  const bs58 = base('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');
  const pubkeyBytes = new Uint8Array(pubkey.map(u => u.toJsNumber()));
  const proofBytes = new Uint8Array(proof.map(u => u.toJsNumber()));
  const pubkeyBase58 = bs58.encode(pubkeyBytes);
  const proofBase58 = bs58.encode(proofBytes);
  const keypair = new Bls12381G1KeyPair({publicKeyBase58: pubkeyBase58});
  const result = keypair.verifyFingerprint(proofBase58);
  return !!result.valid;
  */
}

export function aptos_framework_signature_ed25519_verify(signature: U8[], pubkey: U8[], message: U8[], $c: AptosDataCache): boolean {
  const ec = new elliptic.eddsa("ed25519");
  const keyString = u8ArrayToKeyString(pubkey);
  const key = ec.keyFromPublic(keyString);
  return key.verify(u8ArrayToKeyString(message), u8ArrayToKeyString(signature));
}

export function aptos_framework_signature_secp256k1_recover(message: U8[], recovery_id: U8, signature: U8[], $c: AptosDataCache): [U8[], boolean] {
  throw new Error("Not implemented");
}


export function aptos_framework_table_new_table_handle($c: AptosDataCache, tags: TypeTag[]): U128 {
  return $c.table_new_handle();
}

export function aptos_framework_table_add_box(table: ITable, key: any, value: IBox, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_add_box(table, key, value);
}

export function aptos_framework_table_borrow_box(table: ITable, key: any, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_borrow_box(table, key);
}

export function aptos_framework_table_borrow_box_mut(table: ITable, key: any, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_borrow_box_mut(table, key);
}

export function aptos_framework_table_contains_box(table: ITable, key: any, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_contains_box(table, key);
}

export function aptos_framework_table_remove_box(table: ITable, key: any, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_remove_box(table, key);
}

export function aptos_framework_table_destroy_empty_box(table: ITable, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_destroy_empty_box(table);
}

export function aptos_framework_table_drop_unchecked_box(table: ITable, $c: AptosDataCache, tags: TypeTag[]) {
  return $c.table_drop_unchecked_box(table);
}

export function aptos_framework_transaction_context_get_script_hash($c: AptosDataCache): U8[] {
  // we only support ScriptFunction, for which script hash is empty
  return [];
}

export interface ITypeInfo {
  account_address: HexString;
  module_name: U8[];
  struct_name: U8[];
  typeTag: TypeTag;
}

class ActualTypeInfoClass {
  static moduleAddress = new HexString("0x1");
  static moduleName = "TypeInfo";
  static structName: string = "TypeInfo";
  static typeParameters: TypeParamDeclType[] = [

  ];
  static fields: FieldDeclType[] = [
  { name: "account_address", typeTag: AtomicTypeTag.Address },
  { name: "module_name", typeTag: new VectorTag(AtomicTypeTag.U8) },
  { name: "struct_name", typeTag: new VectorTag(AtomicTypeTag.U8) }];

  account_address: HexString;
  module_name: U8[];
  struct_name: U8[];

  constructor(proto: any, public typeTag: TypeTag) {
    this.account_address = proto['account_address'] as HexString;
    this.module_name = proto['module_name'] as U8[];
    this.struct_name = proto['struct_name'] as U8[];
  }

  typeFullname(): string {
    return `${this.account_address.toShortString()}::${u8str(this.module_name)}::${u8str(this.struct_name)}`;
  }
  toTypeTag() {
    return parseTypeTagOrThrow(this.typeFullname());
  }
  moduleName() { return u8str(this.module_name); }
  structName() { return u8str(this.struct_name); }
}

function stringToU8Array(val: string): U8[] {
  return Array.from(new TextEncoder().encode(val)).map(u => new U8(bigInt(u)));
}

export function aptos_framework_type_info_type_of($c: AptosDataCache, tags: TypeTag[]): ActualTypeInfoClass {
  if (tags.length !== 1) {
    throw new Error(`Expect 1 typetag, but received: ${tags.length}`);
  }
  const tag = tags[0];
  if (!(tag instanceof StructTag)) {
    throw new Error("type_of requires Struct type as type argument");
  }
  const struct_name = tag.typeParams.length > 0 ? `${tag.name}::${getTypeParamsString(tag.typeParams)}` : tag.name;
  const newTag = new StructTag(new HexString("0x1"), "TypeInfo", "TypeInfo", []);
  return new ActualTypeInfoClass({
    account_address: tag.address,
    module_name: stringToU8Array(tag.module),
    struct_name: stringToU8Array(struct_name),
  }, newTag);
}
