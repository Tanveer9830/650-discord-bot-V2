'use strict';

const SNOWFLAKE = /^\d{17,20}$/;

function isSnowflake(value) {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}

module.exports = { isSnowflake, SNOWFLAKE };
