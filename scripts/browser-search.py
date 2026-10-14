"""Supplemental browser proof on production builds; never alters the frozen contract."""
import argparse, json, pathlib, re
from playwright.sync_api import sync_playwright, expect
p = argparse.ArgumentParser()
p.add_argument('--url', required=True); p.add_argument('--executable', required=True)
p.add_argument('--output', required=True); p.add_argument('--side', required=True)
p.add_argument('--inspect', action='store_true')
a = p.parse_args(); out = pathlib.Path(a.output); out.mkdir(parents=True, exist_ok=True)
errors = []; steps = []; result = {'side': a.side, 'status': 'running', 'errors': errors, 'steps': steps, 'network': 'online-supplemental'}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=a.executable)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
    context.tracing.start(screenshots=True, snapshots=True, sources=False)
    page = context.new_page(); page.set_default_timeout(15000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('requestfailed', lambda r: errors.append('request failed ' + r.url))
    page.on('response', lambda r: errors.append('HTTP ' + str(r.status) + ' ' + r.url) if r.status >= 400 else None)
    try:
        page.goto(a.url + '/editor', wait_until='networkidle')
        page.get_by_text('PostgreSQL', exact=True).click()
        page.locator('button[aria-label="confirm"]').click()
        page.locator('button').filter(has_text='Add table').click()
        page.get_by_text(re.compile(r'^table_')).first.click()
        page.locator('input[placeholder="Name"]').nth(0).fill('customers')
        page.locator('input[placeholder="Name"]').nth(0).press('Tab')
        expect(page.get_by_text('Tables (1)', exact=True)).to_be_visible()
        page.locator('button').filter(has_text='Add column').click()
        page.locator('input[placeholder="Name"]').nth(2).fill('account_id')
        page.locator('input[placeholder="Name"]').nth(2).press('Tab')
        page.get_by_text('Type', exact=True).click()
        page.locator('.semi-select input').last.fill('INTEGER')
        page.keyboard.press('ArrowDown'); page.keyboard.press('Enter')
        expect(page.get_by_text('Type', exact=True)).to_have_count(0)
        steps.append('Created customers table and account_id INTEGER column through the UI')
        if a.inspect:
            print(json.dumps(page.locator('input').evaluate_all('(nodes) => nodes.map(n => ({placeholder:n.placeholder,outer:n.outerHTML}))')))
            page.get_by_label('Filter TreeSelect item', exact=True).fill('customers')
            page.wait_for_timeout(500)
            print(page.locator('.semi-tree-select-option-list').count())
            print(page.locator('[role=tree]').evaluate_all('(nodes)=>nodes.map(n=>n.outerHTML)'))
            print(page.locator('body').inner_text()[-6000:])
            print(json.dumps(page.locator('input').evaluate_all('(nodes) => nodes.map(n => ({placeholder:n.placeholder,outer:n.outerHTML}))')))
        else:
            search = page.get_by_label('Filter TreeSelect item', exact=True)
            def search_label(query, label, should_match):
                if page.get_by_role('tree').count() == 0:
                    page.get_by_role('combobox', name='TreeSelect', exact=True).get_by_role('img', name='chevron_down', exact=True).click()
                search.fill(query)
                expect(search).to_have_value(query)
                option = page.locator('.semi-tree-option-label-text').filter(has_text=re.compile('^'+re.escape(label)+'$'))
                if should_match:
                    expect(option).to_be_visible()
                else:
                    expect(option).to_have_count(0)
                    # Baseline keeps unmatched root nodes visible by upstream design.
                    expect(page.locator('.semi-tree-option-label-text').filter(has_text=re.compile('^customers$'))).to_be_visible()
                return option
            search_label('customers', 'customers', True).click()
            expect(page.get_by_role('tree')).to_have_count(0)
            steps.append('Exact table search and selection works')
            search_label('custmers', 'customers', True)
            page.screenshot(path=str(out / (a.side + '-table-typo.png')))
            if a.side == 'candidate':
                page.get_by_role('treeitem').filter(has_text='customers').click()
                expect(page.get_by_role('tree')).to_have_count(0)
            else:
                search.press('Escape')
                expect(page.get_by_role('tree')).to_have_count(0)
            steps.append('Table remains discoverable with a typo; column test below demonstrates the baseline gap')
            option = search_label('acount_id', 'account_id', a.side == 'candidate')
            page.screenshot(path=str(out / (a.side + '-column-typo.png')))
            if a.side == 'candidate':
                # Click the child label, avoiding the parent tree item that contains it.
                page.locator('.semi-tree-option-label-text').filter(has_text=re.compile('^account_id$')).click()
                expect(page.locator('input[placeholder="Name"]').nth(2)).to_be_focused()
                expect(page.get_by_role('tree')).to_have_count(0)
                steps.append('Selecting fuzzy column result focuses the existing column editor')
            else:
                search.press('Escape')
                expect(page.get_by_role('tree')).to_have_count(0)
            if page.get_by_role('tree').count() == 0:
                page.get_by_role('combobox', name='TreeSelect', exact=True).get_by_role('img', name='chevron_down', exact=True).click()
            search.fill('zzzzzzzzzz')
            if a.side == 'candidate':
                expect(page.get_by_text('Not found', exact=True)).to_be_visible()
                expect(page.get_by_role('treeitem')).to_have_count(0)
            else:
                expect(page.locator('.semi-tree-option-label-text').filter(has_text=re.compile('^customers$'))).to_be_visible()
                expect(page.get_by_text('Not found', exact=True)).to_have_count(0)
            search.fill('')
            expect(page.locator('.semi-tree-option-label-text').filter(has_text=re.compile('^customers$'))).to_be_visible()
            search.press('Escape')
            steps.append('Unrelated query is empty only in candidate; clearing restores the table')
            page.keyboard.press('ControlOrMeta+s')
            expect(page.get_by_text(re.compile('Last saved'))).to_be_visible()
            page.reload(wait_until='networkidle')
            expect(page.get_by_text('customers', exact=True).last).to_be_visible()
            expect(page.get_by_text('account_id', exact=True).last).to_be_visible()
            search_label('custmers', 'customers', True)
            search.press('Escape')
            page.get_by_text('Problems', exact=True).click()
            expect(page.get_by_text('No problems were detected.', exact=True)).to_be_visible()
            steps.append('Saved schema reloads without problems; fuzzy behavior persists')
        page.screenshot(path=str(out / (a.side + '.png')))
        assert not errors, errors
        result['status'] = 'passed'
    except Exception as e:
        result['status'] = 'failed'; result['error'] = str(e)
        page.screenshot(path=str(out / (a.side + '-failure.png')))
        raise
    finally:
        (out / (a.side + '.json')).write_text(json.dumps(result, indent=2))
        context.tracing.stop(path=str(out / (a.side + '-trace.zip')))
        browser.close()
