"""Supplemental production drawDB consumer regression; not a UI for the authored history boundary."""
import argparse,json,pathlib,re
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--executable',required=True);p.add_argument('--output',required=True);p.add_argument('--inspect',action='store_true');a=p.parse_args()
out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True);errors=[];steps=[];result={'status':'running','errors':errors,'steps':steps,'scope':'Existing drawDB Issues consumer and persisted schema; history boundary covered by callable tests.'}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=a.executable,headless=True);ctx=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block');ctx.tracing.start(screenshots=True,snapshots=True,sources=False);page=ctx.new_page();page.set_default_timeout(20000)
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:errors.append('request failed '+r.url));page.on('response',lambda r:errors.append('HTTP '+str(r.status)+' '+r.url) if r.status>=400 else None)
    try:
        page.goto(a.url+'/editor',wait_until='networkidle')
        if a.inspect:
            print(page.locator('body').inner_text()[:5000]);print(page.locator('button').all_text_contents())
        else:
            page.get_by_text('PostgreSQL',exact=True).click();page.locator('button[aria-label="confirm"]').click()
            page.locator('button').filter(has_text='Add table').click();page.get_by_text(re.compile('^table_')).first.click()
            page.locator('input[placeholder="Name"]').nth(0).fill('customers');page.locator('input[placeholder="Name"]').nth(0).press('Tab');expect(page.get_by_text('Tables (1)',exact=True)).to_be_visible();steps.append('Created and renamed an actual table')
            page.locator('button').filter(has_text='Add column').click();page.locator('input[placeholder="Name"]').nth(2).fill('account_id');page.locator('input[placeholder="Name"]').nth(2).press('Tab')
            page.get_by_text('Type',exact=True).click();page.locator('.semi-select input').last.fill('INTEGER');page.keyboard.press('ArrowDown');page.keyboard.press('Enter');expect(page.get_by_text('Type',exact=True)).to_have_count(0);steps.append('Created and typed a column')
            page.keyboard.press('ControlOrMeta+s');expect(page.get_by_text(re.compile('Last saved'))).to_be_visible();page.reload(wait_until='networkidle')
            expect(page.get_by_text('customers',exact=True).last).to_be_visible();expect(page.get_by_text('account_id',exact=True).last).to_be_visible();page.get_by_text('Problems',exact=True).click();expect(page.get_by_text('No problems were detected.',exact=True)).to_be_in_viewport(ratio=1);steps.append('Saved, reloaded and verified actual Issues consumer output')
            page.screenshot(path=str(out/'persisted.png'));assert not errors,errors
        result['status']='passed'
    except Exception as e:
        result['status']='failed';result['error']=str(e);page.screenshot(path=str(out/'failure.png'))
    finally:
        ctx.tracing.stop(path=str(out/'trace.zip'));browser.close();(out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if result['status']!='passed':raise SystemExit(1)
