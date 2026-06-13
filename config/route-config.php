<?php
// config/route-config.php

require_once __DIR__ . '/paths.php';

header('Content-Type: application/javascript');

echo "window.__RESOLVE = '/config/resolve.php';\n";

$page = $_GET['page'] ?? '';

switch ($page) {

  case 'portal':
    echo "window.__ROUTES = " . json_encode([
      'portal-home'             => 'x7k2m',
      'portal-dashboard'        => 'p9q4n',
      'portal-adminPanel'       => 'r3w8j',
      'portal-settings'         => 'z1v5t',
      'portal-account'          => 'b6h0c',
      'portal-about'            => 'f2s9d',
      'portal-readme'           => 'n8x1q',
      'portal-employees'        => 'ger34',
      'portal-datalog'          => 'fvn53',
      'portal-proxcode'         => 'f74fa',
      'portal-attendance'       => 'hft21',
      'portal-remarks'          => 'g434s',
      'portal-scanTest'         => 'sc4nt',

    ]) . ";\n";
    echo "window.__DIR_ROUTES = " . json_encode([
      'portal-proximity'        => 'mert3',
      'portal-facial'           => 'sdf63',
    ]) . ";\n";
    break;

  case 'mainFrame':
    echo "window.__APP_ROUTES = " . json_encode([
      'mainFrame-employees'     => 'ger34',
      'mainFrame-datalog'       => 'fvn53',
      'mainFrame-proximity'     => 'f74fa',
      'mainFrame-attendance'    => 'hft21',
      'mainFrame-remarks'       => 'g434s',
      'mainFrame-scanTest'      => 'sc4nt',
      'mainFrame-dashboard'     => 'p9q4n',
      'mainFrame-adminPanel'    => 'r3w8j',
      'mainFrame-account'       => 'b6h0c',
      'mainFrame-test'          => 'tst03',
      'mainFrame-user'          => 'adm01',
      'mainFrame-group'         => 'adm02',
      'mainFrame-logs'          => 'adm03',
      'mainFrame-myAdmin'       => 'adm04',
    ]) . ";\n";
    break;

  case 'require':
    echo "window.__DIR_ROUTES = " . json_encode([
      'require-proximity'       => 'mert3',
      'require-manual'          => 'nf35d',
      'require-facial'          => 'sdf63',
    ]) . ";\n";
    break;

  case 'proximity':
    echo "window.__DIR_ROUTES = " . json_encode([
      'prox-proximity'          => 'mert3',
      'prox-manual'             => 'nf35d',
      'prox-facial'             => 'sdf63',
    ]) . ";\n";
    break;

  case 'login':
    echo "window.__DIR_ROUTES = " . json_encode([
      'login'                   => 'bvdf4',
      'forget'                  => 'h23as',
      'register'                => 'l23fa',
    ]) . ";\n";
    break;

  case 'endpoint':
    echo "window.__API_ROUTES = " . json_encode([
      'api-employees'           => 'tg54d',
      'api-datalog'             => 'qe52g',
      'api-proximity'           => 'l4gs2',
      'api-remarks'             => 'vf3df',
      'api-attendance'          => 'ul3a4',
      'api-qrproximity'         => 'i5es2',
      'api-scanTest'            => 'hefs4',
      'api-audio'               => 'ght3s',
      'api-notification'        => 'gdh43',
      'api-userid'              => 'fger4',
      'api-sync'                => 'sy1nc',
    ]) . ";\n";
    break;

  case 'sync':
    echo "window.__SYNC_ROUTES = " . json_encode([
      'sync-queue' => 'sy1nc',
    ]) . ";\n";
    break;

  default:
    echo "// no route map for this page\n";
    break;
}
